import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IStorageService,
  STORAGE_SERVICE,
  DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertTripOwnership } from '../../common/helpers/scope-filter';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { DocumentsService } from '../documents/documents.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { v4 as uuidv4 } from 'uuid';
import { type ManifestKind, coerceManifestKind, manifestSubPath } from './manifest.types';

/**
 * Manifest = document récapitulatif d'un trajet (passagers ET/OU colis).
 *
 * Depuis 2026-04-19 : entité persistée (`manifests` table) dont le cycle de vie
 * est gouverné par le blueprint `manifest-standard` :
 *
 *   DRAFT → submit → SUBMITTED → sign → SIGNED → archive → ARCHIVED
 *                              → reject → REJECTED → revise → DRAFT
 *
 * Toutes les transitions passent par `WorkflowEngine.transition()` — qui
 * applique le contrat permissions + guards + audit log + outbox. Ce service
 * n'écrit JAMAIS `status` directement ; il délègue à l'engine.
 *
 * Le PDF figé (signedPdfStorageKey) est généré côté service au moment de la
 * signature, dans un try/catch indépendant : si la génération échoue, la
 * transition reste valide — le PDF peut être régénéré offline via
 * `backfillSignedPdfs()`. La signature est l'événement métier ; le PDF est
 * un artefact reconstruisible.
 *
 * Règle stricte : `@@unique([tenantId, tripId, kind])` en DB garantit qu'il
 * ne peut y avoir qu'UN manifeste par (trip, kind). La re-génération après
 * REJECTED passe par l'action `revise` qui réinitialise à DRAFT.
 */
@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);

  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    private readonly docs:     DocumentsService,
    @Inject(STORAGE_SERVICE) private readonly storage:  IStorageService,
    @Inject(EVENT_BUS)       private readonly eventBus: IEventBus,
  ) {}

  // ─── Génération ────────────────────────────────────────────────────────────

  /**
   * Crée (ou réutilise) un Manifest au statut DRAFT puis transitionne vers
   * SUBMITTED via l'engine (action `submit`, perm `data.manifest.generate.agency`).
   *
   * Idempotent :
   *   - Si manifeste inexistant → création DRAFT + submit → SUBMITTED
   *   - Si déjà SUBMITTED/SIGNED/ARCHIVED → retour tel quel (pas de retour en arrière)
   *   - Si REJECTED → transition `revise` pour revenir à DRAFT avant `submit`
   */
  async generate(
    tenantId: string,
    tripId:   string,
    actor:    CurrentUserPayload,
    rawKind:  unknown = 'ALL',
  ) {
    const kind = coerceManifestKind(rawKind);
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: {
        travelers: true,
        shipments: { include: { parcels: true } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    const parcelCount    = trip.shipments.reduce((acc, s) => acc + s.parcels.length, 0);
    const passengerCount = trip.travelers.length;

    // Upsert Manifest — idempotent sur (tenantId, tripId, kind)
    let manifest = await this.prisma.manifest.findFirst({
      where: { tenantId, tripId, kind },
    });

    if (!manifest) {
      const placeholderKey = `${tenantId}/${manifestSubPath(tripId, kind)}/${Date.now()}.pdf`;
      manifest = await this.prisma.manifest.create({
        data: {
          tenantId,
          tripId,
          kind,
          status:         'DRAFT',
          storageKey:     placeholderKey,
          passengerCount,
          parcelCount,
          generatedById:  actor.id,
        },
      });
    } else {
      // Met à jour les compteurs même sur manifeste existant (ex. repeat generate
      // avant signature) pour refléter l'état courant du trajet
      if (manifest.status === 'DRAFT' || manifest.status === 'REJECTED') {
        manifest = await this.prisma.manifest.update({
          where: { id: manifest.id },
          data:  { passengerCount, parcelCount },
        });
      }
    }

    // REJECTED → revise → DRAFT (permission = perm `data.manifest.generate.agency`)
    if (manifest.status === 'REJECTED') {
      const result = await this.transition(manifest, 'revise', actor);
      manifest = await this.prisma.manifest.findFirstOrThrow({ where: { id: result.entity.id } });
    }

    // DRAFT → submit → SUBMITTED
    if (manifest.status === 'DRAFT') {
      const result = await this.transition(manifest, 'submit', actor);
      manifest = await this.prisma.manifest.findFirstOrThrow({ where: { id: result.entity.id } });
    }

    // SUBMITTED / SIGNED / ARCHIVED → retour tel quel (idempotent)
    return this.toDto(manifest);
  }

  // ─── Signature ─────────────────────────────────────────────────────────────

  /**
   * Transition SUBMITTED → SIGNED via l'engine (perm `data.manifest.sign.agency`).
   * Après succès, génère le PDF figé et archive la clé + la signature SVG.
   *
   * Si le manifeste est déjà SIGNED → retour idempotent (pas de nouvelle PDF).
   * Si le PDF échoue → la transition reste valide, `signedPdfStorageKey` reste
   * null et peut être regénéré via `backfillSignedPdfs()`.
   */
  async sign(
    tenantId:     string,
    manifestId:   string,
    actor:        CurrentUserPayload,
    signatureSvg?: string,
  ) {
    const MAX_SVG_BYTES = 256 * 1024;
    const safeSvg = signatureSvg && signatureSvg.length <= MAX_SVG_BYTES
      ? signatureSvg
      : null;

    let manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} introuvable`);

    // Déjà signé → idempotent (mais régénère le PDF si manquant — self-healing)
    if (manifest.status === 'SIGNED' || manifest.status === 'ARCHIVED') {
      if (!manifest.signedPdfStorageKey) {
        manifest = await this.tryPrintAndAttachPdf(manifest, actor);
      }
      return this.toDto(manifest);
    }

    if (manifest.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Manifest en statut ${manifest.status} — attendu SUBMITTED avant signature`,
      );
    }

    // Transition SUBMITTED → SIGNED — signedAt/signedById/signatureSvg inclus
    // ATOMIQUEMENT dans le persist callback. Plus de race "SIGNED sans signedAt".
    const result = await this.transition(manifest, 'sign', actor, {
      signedAt:     new Date(),
      signedById:   actor.id,
      signatureSvg: safeSvg,
    });
    manifest = await this.prisma.manifest.findFirstOrThrow({ where: { id: result.entity.id } });

    // PDF figé — tolérant à l'échec (self-healing possible au prochain getById)
    manifest = await this.tryPrintAndAttachPdf(manifest, actor);

    return this.toDto(manifest);
  }

  // ─── Lecture ───────────────────────────────────────────────────────────────

  async findByTrip(tenantId: string, tripId: string, scope?: ScopeContext) {
    if (scope) await assertTripOwnership(this.prisma, tenantId, tripId, scope);
    const rows = await this.prisma.manifest.findMany({
      where:   { tenantId, tripId },
      orderBy: { kind: 'asc' },
    });
    return rows.map(m => this.toDto(m));
  }

  async findOne(tenantId: string, manifestId: string, scope?: ScopeContext) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} introuvable`);
    if (scope) await assertTripOwnership(this.prisma, tenantId, manifest.tripId, scope);
    return this.toDto(manifest);
  }

  /**
   * Retourne l'URL signée du PDF figé d'un manifeste. Requiert que le manifeste
   * soit SIGNED et qu'un signedPdfStorageKey soit présent.
   */
  async getDownloadUrl(tenantId: string, manifestId: string, scope?: ScopeContext) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} introuvable`);
    if (scope) await assertTripOwnership(this.prisma, tenantId, manifest.tripId, scope);

    if (!manifest.signedPdfStorageKey) {
      throw new BadRequestException('PDF signé indisponible pour ce manifeste');
    }
    return this.storage.getDownloadUrl(
      tenantId,
      manifest.signedPdfStorageKey,
      DocumentType.MAINTENANCE_DOC,
    );
  }

  // ─── Backfill ──────────────────────────────────────────────────────────────

  /**
   * Régénère le PDF signé pour les manifestes SIGNED sans `signedPdfStorageKey`.
   * Idempotent (un second run n'a rien à faire).
   *
   * @param tenantId null = scope plateforme (SUPER_ADMIN uniquement côté controller)
   */
  async backfillSignedPdfs(
    tenantId: string | null,
    actor:    CurrentUserPayload,
  ): Promise<{
    scanned: number;
    generated: number;
    skipped: number;
    failed: number;
    errors: Array<{ manifestId: string; error: string }>;
  }> {
    const candidates = await this.prisma.manifest.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        status:              'SIGNED',
        signedPdfStorageKey: null,
      },
      orderBy: { signedAt: 'asc' },
    });

    let generated = 0;
    let failed    = 0;
    const errors: Array<{ manifestId: string; error: string }> = [];

    for (const m of candidates) {
      try {
        await this.tryPrintAndAttachPdf(m, actor);
        generated += 1;
      } catch (err) {
        failed += 1;
        errors.push({ manifestId: m.id, error: (err as Error)?.message ?? String(err) });
      }
    }

    this.logger.log(
      `[Manifest] backfillSignedPdfs tenant=${tenantId ?? 'ALL'} scanned=${candidates.length} generated=${generated} failed=${failed}`,
    );
    return {
      scanned:   candidates.length,
      generated,
      skipped:   0,
      failed,
      errors,
    };
  }

  // ─── Helpers privés ────────────────────────────────────────────────────────

  /**
   * Passe l'entité + l'action au WorkflowEngine. Le moteur applique :
   *   - La résolution WorkflowConfig(tenantId, 'Manifest', fromState, action)
   *   - La vérification de permission (RolePermission) contre l'acteur
   *   - Les guards applicatifs (aucun ici — les transitions sont pures)
   *   - La persistance atomique (status + version)
   *   - L'audit log via LiveWorkflowIO
   *   - L'outbox event via `eventBus.publish()` dans la persist callback
   */
  private async transition(
    manifest: { id: string; status: string; tenantId: string; version: number },
    action:   string,
    actor:    CurrentUserPayload,
    extras?:  { signedAt?: Date; signedById?: string; signatureSvg?: string | null },
  ) {
    return this.workflow.transition(manifest as Parameters<typeof this.workflow.transition>[0], {
      action,
      actor,
    }, {
      aggregateType: 'Manifest',
      persist: async (entity, state, prisma) => {
        // Champs de signature inclus atomiquement avec la transition :
        // évite la fenêtre de race "status=SIGNED mais signedAt=null" qui
        // existait quand un update séparé suivait la transition.
        const data: Record<string, unknown> = { status: state, version: { increment: 1 } };
        if (extras?.signedAt     !== undefined) data.signedAt     = extras.signedAt;
        if (extras?.signedById   !== undefined) data.signedById   = extras.signedById;
        if (extras?.signatureSvg !== undefined) data.signatureSvg = extras.signatureSvg;

        const updated = await prisma.manifest.update({
          where: { id: entity.id },
          data,
        });
        const event: DomainEvent = {
          id:            uuidv4(),
          type:          `manifest.${action.toLowerCase()}`,
          tenantId:      entity.tenantId,
          aggregateId:   entity.id,
          aggregateType: 'Manifest',
          payload: {
            manifestId: entity.id,
            action,
            fromState:  entity.status,
            toState:    state,
            actorId:    actor.id,
          },
          occurredAt: new Date(),
        };
        await this.eventBus.publish(
          event,
          prisma as unknown as Parameters<typeof this.eventBus.publish>[1],
        );
        return updated as typeof entity;
      },
    });
  }

  /**
   * Génère le PDF figé via DocumentsService et stocke la clé sur le manifeste.
   * Isolation try/catch : un échec de génération ne doit JAMAIS faire échouer
   * la signature déjà actée côté workflow.
   */
  private async tryPrintAndAttachPdf(
    manifest: Awaited<ReturnType<PrismaService['manifest']['findFirst']>> & object,
    actor:    CurrentUserPayload,
  ) {
    try {
      const kind   = coerceManifestKind((manifest as { kind: string }).kind);
      const tripId = (manifest as { tripId: string }).tripId;
      const result = await this.docs.printManifest(
        manifest.tenantId, tripId, actor, undefined, kind,
      );
      const signedPdfStorageKey = (result as { storageKey?: string })?.storageKey ?? null;
      if (!signedPdfStorageKey) return manifest;
      return this.prisma.manifest.update({
        where: { id: (manifest as { id: string }).id },
        data:  { signedPdfStorageKey },
      });
    } catch (err) {
      this.logger.error(
        `[Manifest] PDF generation failed manifest=${(manifest as { id: string }).id}: ${(err as Error)?.message ?? err}`,
      );
      return manifest;
    }
  }

  private toDto(m: {
    id: string; tenantId: string; tripId: string; kind: string; status: string;
    storageKey: string | null; signedPdfStorageKey: string | null;
    passengerCount: number; parcelCount: number;
    signedAt: Date | null; signedById: string | null;
    signatureSvg?: string | null;
    generatedAt: Date; generatedById: string;
    version: number;
  }) {
    return {
      id:                  m.id,
      tenantId:            m.tenantId,
      tripId:              m.tripId,
      kind:                m.kind,
      status:              m.status,
      storageKey:          m.storageKey,
      signedPdfStorageKey: m.signedPdfStorageKey,
      passengerCount:      m.passengerCount,
      parcelCount:         m.parcelCount,
      signedAt:            m.signedAt,
      signedById:          m.signedById,
      // Exposé au client : permet d'afficher la signature comme preuve visuelle
      // après recharge (sinon perdue côté UI). La taille est bornée à 256 KB
      // côté service au moment de la signature, donc safe à inclure dans la
      // réponse JSON.
      signatureSvg:        m.signatureSvg ?? null,
      generatedAt:         m.generatedAt,
      generatedById:       m.generatedById,
      version:             m.version,
    };
  }

  /**
   * Rejette un manifeste SUBMITTED (ex. incohérence détectée) → REJECTED.
   * La re-génération ultérieure (`generate()`) fera `revise` → DRAFT → `submit`.
   */
  async reject(tenantId: string, manifestId: string, actor: CurrentUserPayload) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} introuvable`);
    if (manifest.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Rejet impossible depuis le statut ${manifest.status} — attendu SUBMITTED`,
      );
    }
    const result = await this.transition(manifest, 'reject', actor);
    const refreshed = await this.prisma.manifest.findFirstOrThrow({ where: { id: result.entity.id } });
    return this.toDto(refreshed);
  }

  /**
   * Archive un manifeste SIGNED (fin de rétention, conformité comptable).
   * Perm `data.manifest.print.agency` (cohérent avec le blueprint manifest-standard).
   */
  async archive(tenantId: string, manifestId: string, actor: CurrentUserPayload) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} introuvable`);
    if (manifest.status !== 'SIGNED') {
      throw new BadRequestException(
        `Archivage impossible depuis le statut ${manifest.status} — attendu SIGNED`,
      );
    }
    const result = await this.transition(manifest, 'archive', actor);
    const refreshed = await this.prisma.manifest.findFirstOrThrow({ where: { id: result.entity.id } });
    return this.toDto(refreshed);
  }
}
