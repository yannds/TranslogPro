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
          code:      dto.code.trim().toUpperCase(),
          label:     dto.label.trim(),
          labelKey:  dto.labelKey,
          rate:      dto.rate,
          kind:      dto.kind ?? 'PERCENT',
          base:      dto.base ?? 'SUBTOTAL',
          appliesTo: dto.appliesTo ?? ['ALL'],
          sortOrder: dto.sortOrder ?? 0,
          enabled:   dto.enabled ?? true,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
          validTo:   dto.validTo   ? new Date(dto.validTo)   : null,
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
    return this.prisma.tenantTax.update({
      where: { id },
      data: {
        ...('code'      in dto ? { code: dto.code!.trim().toUpperCase() } : {}),
        ...('label'     in dto ? { label: dto.label!.trim() } : {}),
        ...('labelKey'  in dto ? { labelKey: dto.labelKey ?? null } : {}),
        ...('rate'      in dto ? { rate: dto.rate! } : {}),
        ...('kind'      in dto ? { kind: dto.kind! } : {}),
        ...('base'      in dto ? { base: dto.base! } : {}),
        ...('appliesTo' in dto ? { appliesTo: dto.appliesTo! } : {}),
        ...('sortOrder' in dto ? { sortOrder: dto.sortOrder! } : {}),
        ...('enabled'   in dto ? { enabled: dto.enabled! } : {}),
        ...('validFrom' in dto ? { validFrom: dto.validFrom ? new Date(dto.validFrom) : null } : {}),
        ...('validTo'   in dto ? { validTo:   dto.validTo   ? new Date(dto.validTo)   : null } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.tenantTax.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Taxe ${id} introuvable`);
    await this.prisma.tenantTax.delete({ where: { id } });
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
