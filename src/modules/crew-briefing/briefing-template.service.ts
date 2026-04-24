/**
 * BriefingTemplateService — gestion des templates de briefing tenant-scopés.
 *
 * Un tenant possède un `BriefingTemplate` par défaut seedé
 * (prisma/seeds/briefing-template.seed.ts) avec 8 chapitres QHSE. Il peut :
 *   - Créer des templates additionnels (urbain, longue distance, fret…)
 *   - Activer/désactiver/réordonner chapitres et items
 *   - Ajuster isMandatory, requiredQty, evidenceAllowed
 *   - Dupliquer un template pour éditer une variante
 *
 * Toutes les écritures sont tenant-scopées et idempotent-friendly.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export const ITEM_KINDS = ['CHECK', 'QUANTITY', 'DOCUMENT', 'ACKNOWLEDGE', 'INFO'] as const;
export type ItemKind = typeof ITEM_KINDS[number];

export const AUTO_SOURCES = ['DRIVER_REST_HOURS', 'WEATHER', 'MANIFEST_LOADED', 'ROUTE_CONFIRMED'] as const;
export type AutoSource = typeof AUTO_SOURCES[number];

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateTemplateDto {
  name:         string;
  description?: string;
  isDefault?:   boolean;
}

export interface UpdateTemplateDto {
  name?:        string;
  description?: string | null;
  isDefault?:   boolean;
  isActive?:    boolean;
}

export interface UpsertSectionDto {
  code:     string;
  titleFr:  string;
  titleEn:  string;
  order?:   number;
  isActive?: boolean;
}

export interface UpsertItemDto {
  code:             string;
  kind:             ItemKind;
  labelFr:          string;
  labelEn:          string;
  helpFr?:          string | null;
  helpEn?:          string | null;
  requiredQty?:     number;
  isMandatory?:     boolean;
  isActive?:        boolean;
  order?:           number;
  evidenceAllowed?: boolean;
  autoSource?:      AutoSource | null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class BriefingTemplateService {
  private readonly logger = new Logger(BriefingTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Templates ────────────────────────────────────────────────────────────

  async list(tenantId: string) {
    return this.prisma.briefingTemplate.findMany({
      where:   { tenantId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        _count: { select: { sections: true, briefingRecords: true } },
      },
    });
  }

  async getById(tenantId: string, templateId: string) {
    const template = await this.prisma.briefingTemplate.findFirst({
      where:   { id: templateId, tenantId },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: {
            items: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    if (!template) throw new NotFoundException(`Template ${templateId} introuvable`);
    return template;
  }

  async getDefault(tenantId: string) {
    const template = await this.prisma.briefingTemplate.findFirst({
      where: { tenantId, isDefault: true, isActive: true },
      include: {
        sections: {
          where:   { isActive: true },
          orderBy: { order: 'asc' },
          include: {
            items: {
              where:   { isActive: true },
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });
    return template;
  }

  async create(tenantId: string, dto: CreateTemplateDto) {
    const existing = await this.prisma.briefingTemplate.findFirst({
      where: { tenantId, name: dto.name },
    });
    if (existing) {
      throw new BadRequestException(`Un template nommé "${dto.name}" existe déjà`);
    }

    if (dto.isDefault) {
      await this.prisma.briefingTemplate.updateMany({
        where: { tenantId, isDefault: true },
        data:  { isDefault: false },
      });
    }

    return this.prisma.briefingTemplate.create({
      data: {
        tenantId,
        name:        dto.name,
        description: dto.description ?? null,
        isDefault:   dto.isDefault ?? false,
        isActive:    true,
      },
    });
  }

  async update(tenantId: string, templateId: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.briefingTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) throw new NotFoundException(`Template ${templateId} introuvable`);

    if (dto.isDefault === true && !template.isDefault) {
      await this.prisma.briefingTemplate.updateMany({
        where: { tenantId, isDefault: true },
        data:  { isDefault: false },
      });
    }

    return this.prisma.briefingTemplate.update({
      where: { id: templateId },
      data:  {
        name:        dto.name        ?? undefined,
        description: dto.description === undefined ? undefined : dto.description,
        isDefault:   dto.isDefault   ?? undefined,
        isActive:    dto.isActive    ?? undefined,
      },
    });
  }

  /**
   * Duplique un template (sections + items). Le duplicata est isDefault=false
   * et isActive=true par défaut.
   */
  async duplicate(tenantId: string, templateId: string, newName: string) {
    const original = await this.getById(tenantId, templateId);

    const clashing = await this.prisma.briefingTemplate.findFirst({
      where: { tenantId, name: newName },
    });
    if (clashing) throw new BadRequestException(`Un template nommé "${newName}" existe déjà`);

    return this.prisma.$transaction(async (tx) => {
      const copy = await tx.briefingTemplate.create({
        data: {
          tenantId,
          name:        newName,
          description: original.description,
          isDefault:   false,
          isActive:    true,
        },
      });

      for (const sec of original.sections) {
        const newSec = await tx.briefingSection.create({
          data: {
            tenantId,
            templateId: copy.id,
            code:       sec.code,
            titleFr:    sec.titleFr,
            titleEn:    sec.titleEn,
            order:      sec.order,
            isActive:   sec.isActive,
          },
        });

        for (const item of sec.items) {
          await tx.briefingItem.create({
            data: {
              tenantId,
              sectionId:       newSec.id,
              code:            item.code,
              kind:            item.kind,
              labelFr:         item.labelFr,
              labelEn:         item.labelEn,
              helpFr:          item.helpFr,
              helpEn:          item.helpEn,
              requiredQty:     item.requiredQty,
              isMandatory:     item.isMandatory,
              isActive:        item.isActive,
              order:           item.order,
              evidenceAllowed: item.evidenceAllowed,
              autoSource:      item.autoSource,
            },
          });
        }
      }

      return tx.briefingTemplate.findUnique({
        where:   { id: copy.id },
        include: {
          sections: {
            orderBy: { order: 'asc' },
            include: { items: { orderBy: { order: 'asc' } } },
          },
        },
      });
    });
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  async upsertSection(tenantId: string, templateId: string, dto: UpsertSectionDto) {
    await this._assertTemplateOwned(tenantId, templateId);

    const code = dto.code.toUpperCase();
    return this.prisma.briefingSection.upsert({
      where:  { templateId_code: { templateId, code } },
      create: {
        tenantId,
        templateId,
        code,
        titleFr:  dto.titleFr,
        titleEn:  dto.titleEn,
        order:    dto.order    ?? 0,
        isActive: dto.isActive ?? true,
      },
      update: {
        titleFr:  dto.titleFr,
        titleEn:  dto.titleEn,
        order:    dto.order    ?? undefined,
        isActive: dto.isActive ?? undefined,
      },
    });
  }

  async removeSection(tenantId: string, sectionId: string) {
    const section = await this.prisma.briefingSection.findFirst({
      where: { id: sectionId, tenantId },
    });
    if (!section) throw new NotFoundException(`Section ${sectionId} introuvable`);
    await this.prisma.briefingSection.delete({ where: { id: sectionId } });
    return { removed: sectionId };
  }

  // ── Items ────────────────────────────────────────────────────────────────

  async upsertItem(tenantId: string, sectionId: string, dto: UpsertItemDto) {
    const section = await this.prisma.briefingSection.findFirst({
      where: { id: sectionId, tenantId },
    });
    if (!section) throw new NotFoundException(`Section ${sectionId} introuvable`);

    if (!ITEM_KINDS.includes(dto.kind)) {
      throw new BadRequestException(`kind invalide : ${dto.kind}`);
    }
    if (dto.kind === 'INFO' && dto.autoSource && !AUTO_SOURCES.includes(dto.autoSource)) {
      throw new BadRequestException(`autoSource invalide : ${dto.autoSource}`);
    }

    const code = dto.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    return this.prisma.briefingItem.upsert({
      where:  { sectionId_code: { sectionId, code } },
      create: {
        tenantId,
        sectionId,
        code,
        kind:            dto.kind,
        labelFr:         dto.labelFr,
        labelEn:         dto.labelEn,
        helpFr:          dto.helpFr ?? null,
        helpEn:          dto.helpEn ?? null,
        requiredQty:     dto.requiredQty     ?? 1,
        isMandatory:     dto.isMandatory     ?? true,
        isActive:        dto.isActive        ?? true,
        order:           dto.order           ?? 0,
        evidenceAllowed: dto.evidenceAllowed ?? false,
        autoSource:      dto.kind === 'INFO' ? (dto.autoSource ?? null) : null,
      },
      update: {
        kind:            dto.kind,
        labelFr:         dto.labelFr,
        labelEn:         dto.labelEn,
        helpFr:          dto.helpFr ?? null,
        helpEn:          dto.helpEn ?? null,
        requiredQty:     dto.requiredQty     ?? undefined,
        isMandatory:     dto.isMandatory     ?? undefined,
        isActive:        dto.isActive        ?? undefined,
        order:           dto.order           ?? undefined,
        evidenceAllowed: dto.evidenceAllowed ?? undefined,
        autoSource:      dto.kind === 'INFO' ? (dto.autoSource ?? null) : null,
      },
    });
  }

  async toggleItem(tenantId: string, itemId: string, isActive: boolean) {
    const item = await this.prisma.briefingItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} introuvable`);
    return this.prisma.briefingItem.update({
      where: { id: itemId },
      data:  { isActive },
    });
  }

  async removeItem(tenantId: string, itemId: string) {
    const item = await this.prisma.briefingItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException(`Item ${itemId} introuvable`);
    await this.prisma.briefingItem.delete({ where: { id: itemId } });
    return { removed: itemId };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async _assertTemplateOwned(tenantId: string, templateId: string) {
    const t = await this.prisma.briefingTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!t) throw new NotFoundException(`Template ${templateId} introuvable`);
    return t;
  }
}
