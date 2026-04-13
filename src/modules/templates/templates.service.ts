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
import { CreateTemplateDto, UpdateTemplateDto } from './dto/create-template.dto';

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
    return this.storage.getUploadUrl(tenantId, key, DocumentType.TEMPLATE_SOURCE);
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
}
