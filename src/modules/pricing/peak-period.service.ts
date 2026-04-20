/**
 * PeakPeriodService — gestion des périodes peak (calendrier saisonnier).
 *
 * Alimente la 5ème règle du YieldService (priorité maximale — événement
 * calendrier > réaction fillRate). Une période peut majorer le prix
 * (`expectedDemandFactor > 1`) ou l'abaisser en creux (`< 1`).
 *
 * Idempotent : `seedDefaultsForCountry` peut être rappelé — les entrées
 * existantes ne sont pas écrasées.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface CreatePeakPeriodDto {
  code:                  string;
  label:                 string;
  labelKey?:             string;
  countryCode?:          string;
  startDate:             string | Date;
  endDate:               string | Date;
  expectedDemandFactor:  number;
  isHoliday?:            boolean;
  enabled?:              boolean;
}

export type UpdatePeakPeriodDto = Partial<CreatePeakPeriodDto>;

@Injectable()
export class PeakPeriodService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.peakPeriod.findMany({
      where:   { tenantId },
      orderBy: { startDate: 'asc' },
    });
  }

  /** Périodes actives qui englobent la date passée en paramètre. */
  async findActiveForDate(tenantId: string, date: Date) {
    return this.prisma.peakPeriod.findMany({
      where: {
        tenantId,
        enabled:   true,
        startDate: { lte: date },
        endDate:   { gte: date },
      },
      orderBy: { startDate: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreatePeakPeriodDto) {
    this.validate(dto);
    try {
      return await this.prisma.peakPeriod.create({
        data: {
          tenantId,
          code:                 dto.code.trim().toUpperCase(),
          label:                dto.label.trim(),
          labelKey:             dto.labelKey,
          countryCode:          dto.countryCode?.toUpperCase(),
          startDate:            new Date(dto.startDate),
          endDate:              new Date(dto.endDate),
          expectedDemandFactor: dto.expectedDemandFactor,
          isHoliday:            dto.isHoliday ?? false,
          enabled:              dto.enabled ?? true,
          isSystemDefault:      false,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') throw new BadRequestException(`Période ${dto.code} déjà définie pour ce tenant`);
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdatePeakPeriodDto) {
    const existing = await this.prisma.peakPeriod.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Période ${id} introuvable`);
    this.validate({ ...existing, ...dto } as CreatePeakPeriodDto);
    if (existing.isSystemDefault && 'code' in dto) {
      throw new BadRequestException('Le code d\'une période système ne peut pas être modifié');
    }
    const res = await this.prisma.peakPeriod.updateMany({
      where: { id, tenantId },
      data: {
        ...('code'                 in dto ? { code: dto.code!.trim().toUpperCase() }          : {}),
        ...('label'                in dto ? { label: dto.label!.trim() }                      : {}),
        ...('labelKey'             in dto ? { labelKey: dto.labelKey ?? null }                : {}),
        ...('countryCode'          in dto ? { countryCode: dto.countryCode?.toUpperCase() ?? null } : {}),
        ...('startDate'            in dto ? { startDate: new Date(dto.startDate!) }           : {}),
        ...('endDate'              in dto ? { endDate:   new Date(dto.endDate!) }             : {}),
        ...('expectedDemandFactor' in dto ? { expectedDemandFactor: dto.expectedDemandFactor! } : {}),
        ...('isHoliday'            in dto ? { isHoliday: dto.isHoliday! }                     : {}),
        ...('enabled'              in dto ? { enabled: dto.enabled! }                         : {}),
      },
    });
    if (res.count === 0) throw new NotFoundException(`Période ${id} introuvable`);
    return this.prisma.peakPeriod.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.peakPeriod.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Période ${id} introuvable`);
    if (existing.isSystemDefault) {
      throw new BadRequestException(
        'Impossible de supprimer une période système. Désactivez-la via `enabled=false` si besoin.',
      );
    }
    await this.prisma.peakPeriod.deleteMany({ where: { id, tenantId } });
    return { ok: true };
  }

  /** Résout le facteur de demande effectif pour une date : produit des factors
   *  de toutes les périodes actives (un peak Noël × un peak fête nationale
   *  qui se chevauchent rarement mais légitimes). Retourne 1.0 si aucune. */
  async resolveDemandFactor(tenantId: string, date: Date): Promise<{
    factor: number;
    periods: { code: string; label: string; factor: number }[];
  }> {
    const periods = await this.findActiveForDate(tenantId, date);
    const combined = periods.reduce((acc, p) => acc * p.expectedDemandFactor, 1);
    return {
      factor:  combined,
      periods: periods.map(p => ({
        code: p.code, label: p.label, factor: p.expectedDemandFactor,
      })),
    };
  }

  private validate(dto: CreatePeakPeriodDto): void {
    if (!dto.code?.trim())  throw new BadRequestException('code requis');
    if (!dto.label?.trim()) throw new BadRequestException('label requis');
    const start = new Date(dto.startDate);
    const end   = new Date(dto.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('startDate / endDate invalides');
    }
    if (end < start) throw new BadRequestException('endDate doit être ≥ startDate');
    if (typeof dto.expectedDemandFactor !== 'number'
        || !Number.isFinite(dto.expectedDemandFactor)
        || dto.expectedDemandFactor <= 0
        || dto.expectedDemandFactor > 5) {
      throw new BadRequestException('expectedDemandFactor doit être dans ]0, 5]');
    }
  }
}
