import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEntity } from './interfaces/workflow-entity.interface';
import { TransitionInput } from './interfaces/transition-input.interface';
import { GuardDefinition } from './types/guard-definition.type';
import { SideEffectDefinition } from './types/side-effect-definition.type';
import { AuditService } from './audit.service';
import { extractScope } from '../../common/constants/permissions';

/**
 * Whitelist des noms de tables Postgres par aggregateType.
 * Protège contre toute injection SQL dans le SELECT FOR UPDATE NOWAIT.
 * À mettre à jour si un nouveau type d'entité est ajouté au workflow.
 */
const AGGREGATE_TABLE_MAP: Record<string, string> = {
  Trip:     'trips',
  Ticket:   'tickets',
  Traveler: 'travelers',
  Parcel:   'parcels',
  Shipment: 'shipments',
  Bus:      'buses',
  Claim:    'claims',
};

export interface WorkflowTransitionConfig<E extends WorkflowEntity> {
  /** Type d'entité — doit correspondre à WorkflowConfig.entityType en DB */
  aggregateType: string;
  /** Guards applicatifs supplémentaires */
  guards?:       GuardDefinition<E>[];
  /**
   * Side-effects SYNCHRONES CRITIQUES uniquement — exécutés dans la même transaction.
   * Les side-effects non-critiques (notifications, webhooks) doivent passer par l'Outbox
   * pour éviter de bloquer la transaction sur des appels externes.
   */
  sideEffects?:  SideEffectDefinition<E>[];
  /**
   * Callback de persistance — DOIT incrémenter `version` pour le lock optimiste.
   */
  persist: (entity: E, toState: string, prisma: PrismaService) => Promise<E>;
}

export interface WorkflowResult<E extends WorkflowEntity> {
  entity:    E;
  toState:   string;
  fromState: string;
}

@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit:  AuditService,
  ) {}

  /**
   * Exécute une transition selon l'algorithme PRD §III.3 :
   *
   * 1. CONFIG       → WorkflowConfig(tenantId, entityType, fromState, action)
   * 2. PERMISSION   → RolePermission en DB (zero hardcode)
   * 3. GUARDS       → GuardEvaluator applicatif
   * 4. TRANSACTION  → idempotence check + lock + persist + log + audit
   * 5. SIDE EFFECTS → dans la transaction (critiques uniquement)
   *
   * IDEMPOTENCE : check ET insert sont dans la même transaction atomique.
   * Race condition P2002 → capturée et convertie en replay idempotent (409 → entity).
   *
   * LOCKING : SELECT FOR UPDATE NOWAIT sur le vrai nom de table (whitelist),
   * avec `Prisma.raw()` pour éviter l'injection SQL.
   * Échec → ConflictException(423) — jamais swallowed silencieusement.
   */
  async transition<E extends WorkflowEntity>(
    entity: E,
    input:  TransitionInput,
    config: WorkflowTransitionConfig<E>,
  ): Promise<WorkflowResult<E>> {
    const { action, actor, idempotencyKey, ipAddress } = input;

    // Valider le aggregateType contre la whitelist avant toute requête DB
    const tableName = AGGREGATE_TABLE_MAP[config.aggregateType];
    if (!tableName) {
      throw new BadRequestException(
        `aggregateType "${config.aggregateType}" non reconnu par le WorkflowEngine`,
      );
    }

    // ── 1. Résolution (tenantId, entityType, fromState, action) → toState ────
    // Hors transaction : lecture seule, pas de side-effects.
    // La clé composite @@unique([tenantId, entityType, fromState, action, version])
    // garantit qu'un tenant ne peut pas injecter une config pour un autre tenant.
    const wfConfig = await this.prisma.workflowConfig.findFirst({
      where: {
        tenantId:   entity.tenantId,
        entityType: config.aggregateType,
        fromState:  entity.status,
        action,
        isActive:   true,
      },
    });

    if (!wfConfig) {
      throw new BadRequestException(
        `Transition interdite : ${config.aggregateType} état="${entity.status}" action="${action}" ` +
        `(aucune WorkflowConfig active pour tenant=${entity.tenantId})`,
      );
    }

    const toState       = wfConfig.toState as string;
    const requiredPerm  = wfConfig.requiredPerm as string;

    // ── 2. Vérification de permission — DB-driven, zéro hardcode ─────────────
    // Note : le PermissionGuard a déjà vérifié la permission de la route HTTP.
    // Ce deuxième check ici est une défense en profondeur pour les transitions
    // déclenchées programmatiquement (scheduler, side-effects d'autres transitions).
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId: actor.roleId, permission: requiredPerm },
    });
    if (!rp) {
      throw new ForbiddenException(
        `Rôle ne possède pas la permission "${requiredPerm}" requise pour l'action "${action}"`,
      );
    }

    const scope = extractScope(requiredPerm);
    if (scope === 'agency' && !actor.agencyId) {
      throw new ForbiddenException(
        `La permission "${requiredPerm}" exige le scope agency mais l'acteur n'a pas d'agencyId`,
      );
    }

    // ── 3. Guards applicatifs ─────────────────────────────────────────────────
    const ctx = input.context ?? {};
    for (const guard of config.guards ?? []) {
      const allowed = await guard.fn(entity, input, ctx);
      if (!allowed) {
        throw new BadRequestException(
          `Guard "${guard.name}" a bloqué la transition "${action}" → "${toState}"`,
        );
      }
    }

    // ── 4. Transaction atomique ────────────────────────────────────────────────
    return this.prisma.transact(async (tx) => {
      const effectiveKey = idempotencyKey ?? randomUUID();

      // ── 4a. Idempotence check DANS la transaction ────────────────────────
      // Atomique avec l'insert → élimine la race condition.
      const existing = await tx.workflowTransition.findUnique({
        where: { idempotencyKey: effectiveKey },
      });
      if (existing) {
        this.logger.debug(`Idempotent replay: key=${effectiveKey}`);
        return { entity, toState: existing.toState, fromState: existing.fromState };
      }

      // ── 4b. Lock pessimiste — SELECT FOR UPDATE NOWAIT ──────────────────
      // Whitelist validée ci-dessus → Prisma.raw() sans risque d'injection.
      // Ne swallow JAMAIS l'erreur : si le lock échoue, la transaction échoue.
      const rows = (await tx.$queryRaw(
        Prisma.sql`
          SELECT version
          FROM   ${Prisma.raw(`"${tableName}"`)}
          WHERE  id = ${entity.id}
          FOR UPDATE NOWAIT
        `,
      )) as { version: number }[];

      const currentVersion = rows[0]?.version;
      if (currentVersion === undefined) {
        throw new ConflictException(
          `Entité ${config.aggregateType}:${entity.id} introuvable pour lock`,
        );
      }
      if (currentVersion !== entity.version) {
        throw new ConflictException(
          `Modification concurrente détectée sur ${config.aggregateType}:${entity.id} ` +
          `(version attendue=${entity.version}, trouvée=${currentVersion}) — réessayez`,
        );
      }

      // ── 4c. Persistance de l'état cible ─────────────────────────────────
      const updated = await config.persist(entity, toState, tx as unknown as PrismaService);

      // ── 4d. Log de transition (idempotence + historique) ─────────────────
      try {
        await (tx as unknown as PrismaService).workflowTransition.create({
          data: {
            tenantId:       entity.tenantId,
            entityType:     config.aggregateType,
            entityId:       entity.id,
            fromState:      entity.status,
            action,
            toState,
            userId:         actor.id,
            idempotencyKey: effectiveKey,
          },
        });
      } catch (e: any) {
        // P2002 = race condition : un autre pod a commité la même clé entre
        // le findUnique ci-dessus et cet insert. Retourner l'entité existante.
        if (e?.code === 'P2002') {
          this.logger.warn(
            `Idempotency race P2002 capturée pour key=${effectiveKey} — replay safe`,
          );
          const committed = await (tx as unknown as PrismaService).workflowTransition.findUnique({
            where: { idempotencyKey: effectiveKey },
          });
          if (committed) {
            return { entity, toState: committed.toState, fromState: committed.fromState };
          }
        }
        throw e;
      }

      // ── 4e. Audit trail ISO 27001 ─────────────────────────────────────────
      // L'audit est dans la transaction pour garantir qu'il ne peut pas manquer.
      // AuditService.record() avale ses propres erreurs (non-breaking) —
      // mais les erreurs critiques sont quand même loguées.
      await this.audit.record({
        tenantId: entity.tenantId,
        userId:   actor.id,
        action:   requiredPerm,  // permission exercée — format canonique pour SIEM
        resource: `${config.aggregateType}:${entity.id}`,
        oldValue: { status: entity.status, version: entity.version },
        newValue: { status: toState, version: entity.version + 1 },
        ipAddress,
      });

      // ── 4f. Side-effects SYNCHRONES CRITIQUES uniquement ─────────────────
      // Règle : aucun appel HTTP/NATS/gRPC ici. Seules les modifications DB
      // (ex: mise à jour du seat_map) sont admises dans cette transaction.
      // Les notifications, webhooks → OutboxEvent (asynchrone, non-bloquant).
      for (const se of config.sideEffects ?? []) {
        await se.fn(updated, input, ctx);
      }

      this.logger.log(
        `[${config.aggregateType}:${entity.id}] "${entity.status}" --[${action}]--> "${toState}" ` +
        `actor=${actor.id} perm=${requiredPerm}`,
      );

      return { entity: updated, toState, fromState: entity.status };
    });
  }
}
