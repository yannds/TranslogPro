/**
 * TemplatesService — CRUD des DocumentTemplate (métadonnées DB + source MinIO)
 *
 * Architecture :
 *   - Métadonnées stockées en DB (DocumentTemplate model)
 *   - Source .hbs stockée dans MinIO (bucket tenant, clé templates/{slug}/v{version}.hbs)
 *   - Template inline (body non null) — source directement en DB, pas de round-trip MinIO
 *   - Versioning : chaque update incrémente version, garde les anciennes versions actives=false
 *   - Templates système (isSystem=true) — protégés contre suppression tenant
 *
 * Résolution runtime :
 *   getSource(tenantId, slug) → cherche d'abord template tenant, sinon template système
 */
import {
  Injectable, Logger, NotFoundException, ConflictException, ForbiddenException, Inject,
} from '@nestjs/common';
import { PrismaService }  from '../../infrastructure/database/prisma.service';
import {
  IStorageService, STORAGE_SERVICE, DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateTemplateDto, UpdateTemplateDto, DuplicateTemplateDto } from './dto/create-template.dto';
import { STARTER_PACK_SLUGS } from '../../../server/seed/templates/templates.seeder';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  // ─── CRUD ───────────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateTemplateDto, actor: CurrentUserPayload) {
    // Slug unique par tenant (null = système)
    const existing = await this.prisma.documentTemplate.findFirst({
      where: { tenantId, slug: dto.slug, isActive: true },
    });
    if (existing) {
      throw new ConflictException(`Template "${dto.slug}" existe déjà pour ce tenant`);
    }

    const template = await this.prisma.documentTemplate.create({
      data: {
        tenantId,
        name:       dto.name,
        slug:       dto.slug,
        docType:    dto.docType,
        format:     dto.format,
        engine:     dto.engine ?? 'HBS',
        body:       dto.body ?? null,
        schemaJson: dto.schemaJson ? (dto.schemaJson as object) : undefined,
        varsSchema: (dto.varsSchema ?? {}) as object,
        createdById: actor.id,
      },
    });

    this.logger.log(`Template créé id=${template.id} slug=${template.slug} tenant=${tenantId}`);
    return template;
  }

  async findAll(tenantId: string) {
    return this.prisma.documentTemplate.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const t = await this.prisma.documentTemplate.findFirst({ where: { id, tenantId } });
    if (!t) throw new NotFoundException(`Template ${id} introuvable`);
    return t;
  }

  async update(tenantId: string, id: string, dto: UpdateTemplateDto, actor: CurrentUserPayload) {
    const template = await this.findOne(tenantId, id);
    if (template.isSystem) {
      throw new ForbiddenException('Les templates système ne peuvent pas être modifiés par un tenant');
    }

    // Versioning : désactiver l'ancienne version, créer une nouvelle
    await this.prisma.documentTemplate.update({
      where: { id },
      data:  { isActive: false },
    });

    const next = await this.prisma.documentTemplate.create({
      data: {
        tenantId:    template.tenantId,
        name:        dto.name        ?? template.name,
        slug:        template.slug,
        docType:     template.docType,
        format:      template.format,
        engine:      template.engine,
        body:        dto.body        ?? template.body,
        schemaJson:  dto.schemaJson  ? (dto.schemaJson as object) : (template.schemaJson as object | undefined),
        varsSchema:  (dto.varsSchema ?? template.varsSchema ?? {}) as object,
        version:     template.version + 1,
        isSystem:    false,
        isActive:    dto.isActive ?? true,
        storageKey:  template.storageKey,
        createdById: actor.id,
      },
    });

    this.logger.log(`Template mis à jour id=${next.id} v${next.version} slug=${next.slug}`);
    return next;
  }

  async remove(tenantId: string, id: string) {
    const template = await this.findOne(tenantId, id);
    if (template.isSystem) {
      throw new ForbiddenException('Les templates système ne peuvent pas être supprimés');
    }
    await this.prisma.documentTemplate.update({
      where: { id },
      data:  { isActive: false },
    });
    return { deleted: true };
  }

  // ─── Duplication depuis un template système ──────────────────────────────────

  /**
   * Duplique un template (système ou tenant) comme nouveau template éditable.
   * Utilisé pour partir d'un template de base et le personnaliser.
   */
  async duplicate(
    tenantId: string,
    sourceId: string,
    dto: DuplicateTemplateDto,
    actor: CurrentUserPayload,
  ) {
    const source = await this.prisma.documentTemplate.findFirst({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException(`Template source ${sourceId} introuvable`);

    const slug = dto.slug ?? `${source.slug}-custom-${Date.now()}`;

    const existing = await this.prisma.documentTemplate.findFirst({
      where: { tenantId, slug, isActive: true },
    });
    if (existing) {
      throw new ConflictException(`Un template avec le slug "${slug}" existe déjà`);
    }

    const copy = await this.prisma.documentTemplate.create({
      data: {
        tenantId,
        name:        dto.name,
        slug,
        docType:     source.docType,
        format:      source.format,
        engine:      source.engine,
        body:        source.body,
        schemaJson:  source.schemaJson as object | undefined,
        varsSchema:  source.varsSchema as object,
        version:     1,
        isSystem:    false,
        isActive:    true,
        createdById: actor.id,
      },
    });

    this.logger.log(`Template dupliqué: source=${sourceId} → new=${copy.id} slug=${slug}`);
    return copy;
  }

  // ─── pdfme schema save / resolve ─────────────────────────────────────────────

  /**
   * Enregistre le schéma pdfme édité par le Designer UI.
   * Crée une nouvelle version du template avec engine=PDFME et schemaJson mis à jour.
   */
  async savePdfmeSchema(
    tenantId: string,
    id: string,
    schemaJson: Record<string, unknown>,
    actor: CurrentUserPayload,
  ) {
    const template = await this.findOne(tenantId, id);
    if (template.isSystem) {
      throw new ForbiddenException(
        'Template système — dupliquez-le avant de modifier le schéma',
      );
    }

    await this.prisma.documentTemplate.update({
      where: { id },
      data:  { isActive: false },
    });

    const next = await this.prisma.documentTemplate.create({
      data: {
        tenantId:    template.tenantId,
        name:        template.name,
        slug:        template.slug,
        docType:     template.docType,
        format:      template.format,
        engine:      'PDFME',
        body:        null,
        schemaJson:  schemaJson as object,
        varsSchema:  template.varsSchema as object,
        version:     template.version + 1,
        isSystem:    false,
        isActive:    true,
        createdById: actor.id,
      },
    });

    this.logger.log(`Schéma pdfme sauvegardé: id=${next.id} v${next.version} slug=${next.slug}`);
    return next;
  }

  /**
   * Résout le schéma pdfme pour un slug :
   *   1. Template tenant actif engine=PDFME (version max)
   *   2. Template système engine=PDFME
   * Retourne null si aucun template pdfme disponible (fallback vers Puppeteer).
   */
  async resolvePdfmeSchema(
    tenantId: string,
    slug: string,
  ): Promise<{ schemaJson: Record<string, unknown>; template: any } | null> {
    const template =
      (await this.prisma.documentTemplate.findFirst({
        where:   { tenantId, slug, engine: 'PDFME', isActive: true },
        orderBy: { version: 'desc' },
      })) ??
      (await this.prisma.documentTemplate.findFirst({
        where:   { tenantId: null, slug, engine: 'PDFME', isActive: true, isSystem: true },
        orderBy: { version: 'desc' },
      }));

    if (!template?.schemaJson) return null;
    return { schemaJson: template.schemaJson as Record<string, unknown>, template };
  }

  /**
   * Retourne tous les templates système (tenantId=null) visibles pour inspiration.
   */
  async findSystemTemplates(docType?: string) {
    return this.prisma.documentTemplate.findMany({
      where: {
        tenantId: null,
        isSystem: true,
        isActive: true,
        ...(docType ? { docType } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Upload source .hbs ──────────────────────────────────────────────────────

  async uploadSource(tenantId: string, id: string, source: Buffer) {
    const template = await this.findOne(tenantId, id);
    const key = `${tenantId}/templates/${template.slug}/v${template.version}.hbs`;

    await this.storage.putObject(tenantId, key, source, 'text/x-handlebars-template');

    await this.prisma.documentTemplate.update({
      where: { id },
      data:  { storageKey: key, body: null },
    });

    this.logger.log(`Source template uploadée key=${key}`);
    return { storageKey: key };
  }

  async getUploadUrl(tenantId: string, id: string) {
    const template = await this.findOne(tenantId, id);
    const key = `${tenantId}/templates/${template.slug}/v${template.version}.hbs`;
    const signed = await this.storage.getUploadUrl(tenantId, key, DocumentType.TEMPLATE_SOURCE);
    return { uploadUrl: signed.url, fileKey: key, expiresAt: signed.expiresAt };
  }

  // ─── Résolution runtime ──────────────────────────────────────────────────────

  /**
   * Résout la source Handlebars pour un slug donné :
   *   1. Template spécifique au tenant (version max active)
   *   2. Template système (tenantId = null)
   * Retourne { body: string, template }
   */
  async resolveSource(tenantId: string, slug: string): Promise<{ body: string; template: any }> {
    const template =
      (await this.prisma.documentTemplate.findFirst({
        where:   { tenantId, slug, isActive: true },
        orderBy: { version: 'desc' },
      })) ??
      (await this.prisma.documentTemplate.findFirst({
        where:   { tenantId: null, slug, isActive: true, isSystem: true },
        orderBy: { version: 'desc' },
      }));

    if (!template) throw new NotFoundException(`Aucun template "${slug}" disponible`);

    // Cas 1 : corps inline
    if (template.body) return { body: template.body, template };

    // Cas 2 : source dans MinIO
    if (template.storageKey) {
      const buf  = await this.storage.getObject(tenantId, template.storageKey);
      const body = buf.toString('utf-8');
      return { body, template };
    }

    throw new NotFoundException(`Template "${slug}" sans source (body ni storageKey)`);
  }

  // ─── Pack de démarrage ──────────────────────────────────────────────────────

  /**
   * Restaure (ou complète) le pack de démarrage : duplique en copies tenant éditables
   * les templates système listés dans STARTER_PACK_SLUGS qui ne sont pas encore présents.
   * Idempotent — ne touche pas aux templates tenant existants (même slug).
   */
  async restoreStarterPack(tenantId: string, actor: CurrentUserPayload) {
    const systemTemplates = await this.prisma.documentTemplate.findMany({
      where: { tenantId: null, slug: { in: STARTER_PACK_SLUGS }, isActive: true },
    });

    if (systemTemplates.length === 0) {
      throw new NotFoundException(
        'Aucun template système trouvé — exécuter `npm run db:seed` pour charger le catalogue',
      );
    }

    const created: string[] = [];
    const skipped: string[] = [];

    for (const sys of systemTemplates) {
      const already = await this.prisma.documentTemplate.findFirst({
        where: { tenantId, slug: sys.slug },
      });
      if (already) { skipped.push(sys.slug); continue; }

      await this.prisma.documentTemplate.create({
        data: {
          tenantId,
          name:        sys.name,
          slug:        sys.slug,
          docType:     sys.docType,
          format:      sys.format,
          engine:      sys.engine,
          schemaJson:  sys.schemaJson ?? undefined,
          varsSchema:  sys.varsSchema ?? {},
          body:        sys.body,
          version:     1,
          isSystem:    false,
          isActive:    true,
          createdById: actor.id,
        },
      });
      created.push(sys.slug);
    }

    // Marquer un défaut par docType si aucun n'existe encore
    const DEFAULT_SLUGS: Record<string, string> = {
      TICKET: 'ticket-a5', MANIFEST: 'manifest-a4', INVOICE: 'invoice-a4',
      LABEL: 'parcel-label', PACKING_LIST: 'packing-list-a4', ENVELOPE: 'envelope-c5',
    };
    for (const [docType, slug] of Object.entries(DEFAULT_SLUGS)) {
      const hasDefault = await this.prisma.documentTemplate.findFirst({
        where: { tenantId, docType, isDefault: true, isActive: true },
      });
      if (hasDefault) continue;
      const target = await this.prisma.documentTemplate.findFirst({
        where: { tenantId, slug, isActive: true },
      });
      if (target) {
        await this.prisma.documentTemplate.update({ where: { id: target.id }, data: { isDefault: true } });
      }
    }

    this.logger.log(
      `Pack de démarrage restauré pour tenant ${tenantId} : ${created.length} créés, ${skipped.length} ignorés`,
    );
    return { created, skipped };
  }

  // ─── Preview avec données fictives ─────────────────────────────────────────

  /**
   * Génère un aperçu HTML du template avec des données fictives.
   * Pour les templates PUPPETEER, appelle le renderer correspondant avec du mock data.
   * Pour les templates HBS avec body, substitue les variables par des valeurs exemples.
   */
  async preview(tenantId: string, id: string): Promise<string> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { OR: [{ id, tenantId }, { id, tenantId: null }] },
    });
    if (!template) throw new NotFoundException(`Template ${id} introuvable`);

    // Récupérer le nom du tenant pour le mock
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true },
    });
    const tenantName = tenant?.name ?? 'Ma Compagnie';

    // Données fictives selon le type de document
    const now = new Date();
    const dep = new Date(now.getTime() + 3 * 3600_000);  // +3h
    const arr = new Date(now.getTime() + 8 * 3600_000);  // +8h

    if (template.slug === 'ticket-2026' || template.slug === 'ticket-stub-html') {
      const { renderTicket2026 } = await import('../documents/renderers/ticket-2026.renderer');
      return renderTicket2026({
        ticket: {
          id: 'TKT-PREVIEW-001',
          passengerName: 'Jean Dupont',
          seatNumber: '12A',
          pricePaid: 15000,
          status: 'CONFIRMED',
          qrToken: 'PREVIEW-QR-TOKEN-12345',
          createdAt: now,
          class: 'ECONOMY',
          boardingStationName: 'Gare Centrale',
          alightingStationName: 'Gare du Sud',
        },
        trip: {
          id: 'TRIP-PREVIEW-001',
          departureScheduled: dep,
          arrivalScheduled: arr,
          route: { name: 'Brazzaville — Pointe-Noire', originCity: 'Brazzaville', destinationCity: 'Pointe-Noire' },
          bus: { plateNumber: 'BZV-1234-CG', model: 'Mercedes Tourismo' },
        },
        tenantName,
        tenantSlug: tenant?.slug ?? 'preview',
        primaryColor: '#0f172a',
        secondaryColor: '#f59e0b',
        actorId: '00000000-0000-0000-0000-000000000000',
      });
    }

    if (template.slug === 'boarding-pass-2026') {
      const { renderBoardingPass2026 } = await import('../documents/renderers/boarding-pass-2026.renderer');
      return renderBoardingPass2026({
        ticket: {
          id: 'TKT-PREVIEW-001',
          passengerName: 'Jean Dupont',
          seatNumber: '12A',
          qrToken: 'PREVIEW-QR-TOKEN-12345',
          boardingStationName: 'Gare Centrale',
          alightingStationName: 'Gare du Sud',
        },
        trip: {
          departureScheduled: dep,
          route: { originCity: 'Brazzaville', destinationCity: 'Pointe-Noire' },
          bus: { plateNumber: 'BZV-1234-CG' },
        },
        tenantName,
        actorId: '00000000-0000-0000-0000-000000000000',
      });
    }

    // Template HBS/Puppeteer avec body inline — substitution basique des variables
    if (template.body) {
      return template.body
        .replace(/\{\{tenantName\}\}/g, tenantName)
        .replace(/\{\{passengerName\}\}/g, 'Jean Dupont')
        .replace(/\{\{seatNumber\}\}/g, '12A')
        .replace(/\{\{origin\}\}/g, 'Brazzaville')
        .replace(/\{\{destination\}\}/g, 'Pointe-Noire')
        .replace(/\{\{date\}\}/g, now.toLocaleDateString('fr-FR'))
        .replace(/\{\{[^}]+\}\}/g, '—');  // fallback pour les variables inconnues
    }

    // Template PDFME — retourner un placeholder
    if (template.engine === 'PDFME') {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
        .msg { text-align: center; color: #64748b; }
        .msg h2 { color: #1e293b; margin-bottom: 8px; }
      </style></head><body><div class="msg"><h2>${template.name}</h2><p>Ce template utilise le designer visuel PDFME.</p><p>Cliquez sur « Éditer » pour ouvrir le designer interactif.</p></div></body></html>`;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }
      .msg { text-align: center; color: #64748b; }
    </style></head><body><div class="msg"><h2>${template.name}</h2><p>Aucun aperçu disponible pour ce template.</p></div></body></html>`;
  }

  // ─── Default template management ────────────────────────────────────────────

  /**
   * Marque un template comme défaut pour son docType (un seul par docType par tenant).
   * Swap transactionnel : désactive l'ancien défaut, active le nouveau.
   */
  async setAsDefault(tenantId: string, id: string) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id, tenantId, isActive: true },
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.prisma.$transaction([
      // Retirer l'ancien défaut pour ce docType
      this.prisma.documentTemplate.updateMany({
        where: { tenantId, docType: template.docType, isDefault: true },
        data:  { isDefault: false },
      }),
      // Marquer le nouveau
      this.prisma.documentTemplate.update({
        where: { id },
        data:  { isDefault: true },
      }),
    ]);

    this.logger.log(`Template ${template.slug} set as default for ${template.docType} (tenant=${tenantId})`);
    return this.findOne(tenantId, id);
  }

  /**
   * Retire le statut défaut d'un template.
   */
  async unsetDefault(tenantId: string, id: string) {
    const template = await this.prisma.documentTemplate.findFirst({
      where: { id, tenantId, isActive: true },
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.prisma.documentTemplate.update({
      where: { id },
      data:  { isDefault: false },
    });
    return this.findOne(tenantId, id);
  }

  /**
   * Résout le slug du template par défaut pour un docType donné.
   * Ordre de résolution :
   *   1. Template tenant marqué isDefault=true pour ce docType
   *   2. Fallback vers le slug hardcodé fourni (rétro-compatible)
   */
  async resolveDefaultSlug(tenantId: string, docType: string, fallbackSlug: string): Promise<string> {
    const defaultTpl = await this.prisma.documentTemplate.findFirst({
      where:  { tenantId, docType, isDefault: true, isActive: true },
      select: { slug: true },
    });
    return defaultTpl?.slug ?? fallbackSlug;
  }
}
