import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * TenantTaxService — CRUD des taxes tenant (TVA, timbre, taxe gare, …).
 * Toute mutation écrit dans TenantTax ; le TaxCalculatorService consomme
 * l'état final à chaque calcul d'Intent.
 */

export interface CreateTenantTaxDto {
  code:      string;
  label:     string;
  labelKey?: string;
  rate:      number;
  kind?:     'PERCENT' | 'FIXED';
  base?:     'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS';
  appliesTo?: string[];
  sortOrder?: number;
  enabled?:   boolean;
  /** Appliquée au prix facturé. Si false, la taxe est visible (UI pédagogique
   *  grisée) mais n'entre pas dans le total payé par le client. */
  appliedToPrice?:          boolean;
  /** Prise en compte par le simulateur de prix recommandé (module rentabilité).
   *  Permet de projeter "que se passe-t-il si on active cette taxe ?" sans la
   *  facturer. */
  appliedToRecommendation?: boolean;
  validFrom?: string;
  validTo?:   string;
}

export type UpdateTenantTaxDto = Partial<CreateTenantTaxDto>;

@Injectable()
export class TenantTaxService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.tenantTax.findMany({ where: { tenantId }, orderBy: { sortOrder: 'asc' } });
  }

  async create(tenantId: string, dto: CreateTenantTaxDto) {
    this.validate(dto);
    try {
      return await this.prisma.tenantTax.create({
        data: {
          tenantId,
          code:                    dto.code.trim().toUpperCase(),
          label:                   dto.label.trim(),
          labelKey:                dto.labelKey,
          rate:                    dto.rate,
          kind:                    dto.kind ?? 'PERCENT',
          base:                    dto.base ?? 'SUBTOTAL',
          appliesTo:               dto.appliesTo ?? ['ALL'],
          sortOrder:               dto.sortOrder ?? 0,
          enabled:                 dto.enabled ?? true,
          appliedToPrice:          dto.appliedToPrice ?? true,
          appliedToRecommendation: dto.appliedToRecommendation ?? true,
          // isSystemDefault n'est pas exposé à l'API : une taxe créée manuellement
          // par l'admin est toujours custom (supprimable). Seul l'onboarding/backfill
          // marque `isSystemDefault=true` pour la TVA.
          isSystemDefault:         false,
          validFrom:               dto.validFrom ? new Date(dto.validFrom) : null,
          validTo:                 dto.validTo   ? new Date(dto.validTo)   : null,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new BadRequestException(`Taxe ${dto.code} déjà définie pour ce tenant`);
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateTenantTaxDto) {
    const existing = await this.prisma.tenantTax.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Taxe ${id} introuvable`);
    this.validate({ ...existing, ...dto } as CreateTenantTaxDto);
    // Une taxe système (TVA seedée) ne peut pas être renommée/recodée — seuls
    // rate, enabled, appliedToPrice, appliedToRecommendation, validFrom/To sont
    // modifiables. Ça évite de transformer la TVA en autre chose par erreur.
    if (existing.isSystemDefault && ('code' in dto)) {
      throw new BadRequestException('Le code d\'une taxe système ne peut pas être modifié');
    }
    const res = await this.prisma.tenantTax.updateMany({
      where: { id, tenantId },
      data: {
        ...('code'                    in dto ? { code: dto.code!.trim().toUpperCase() }                              : {}),
        ...('label'                   in dto ? { label: dto.label!.trim() }                                          : {}),
        ...('labelKey'                in dto ? { labelKey: dto.labelKey ?? null }                                    : {}),
        ...('rate'                    in dto ? { rate: dto.rate! }                                                   : {}),
        ...('kind'                    in dto ? { kind: dto.kind! }                                                   : {}),
        ...('base'                    in dto ? { base: dto.base! }                                                   : {}),
        ...('appliesTo'               in dto ? { appliesTo: dto.appliesTo! }                                         : {}),
        ...('sortOrder'               in dto ? { sortOrder: dto.sortOrder! }                                         : {}),
        ...('enabled'                 in dto ? { enabled: dto.enabled! }                                             : {}),
        ...('appliedToPrice'          in dto ? { appliedToPrice: dto.appliedToPrice! }                               : {}),
        ...('appliedToRecommendation' in dto ? { appliedToRecommendation: dto.appliedToRecommendation! }             : {}),
        ...('validFrom'               in dto ? { validFrom: dto.validFrom ? new Date(dto.validFrom) : null }         : {}),
        ...('validTo'                 in dto ? { validTo:   dto.validTo   ? new Date(dto.validTo)   : null }         : {}),
      },
    });
    if (res.count === 0) throw new NotFoundException(`Taxe ${id} introuvable`);
    return this.prisma.tenantTax.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.tenantTax.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Taxe ${id} introuvable`);
    if (existing.isSystemDefault) {
      throw new BadRequestException(
        'Impossible de supprimer une taxe système (TVA). Désactivez-la via `enabled=false` si besoin.',
      );
    }
    const res = await this.prisma.tenantTax.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Taxe ${id} introuvable`);
    return { ok: true };
  }

  private validate(dto: CreateTenantTaxDto): void {
    if (!dto.code?.trim())                          throw new BadRequestException('code requis');
    if (!dto.label?.trim())                         throw new BadRequestException('label requis');
    if (typeof dto.rate !== 'number' || dto.rate < 0) throw new BadRequestException('rate doit être >= 0');
    if (dto.kind === 'PERCENT' && dto.rate > 1)     throw new BadRequestException('rate PERCENT doit être une fraction 0..1 (ex: 0.18)');
    if (dto.appliesTo && !dto.appliesTo.length)     throw new BadRequestException('appliesTo ne peut être vide');
  }
}
