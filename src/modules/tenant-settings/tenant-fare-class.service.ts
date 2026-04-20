import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';

/**
 * TenantFareClassService — CRUD des classes de voyage par tenant.
 *
 * Remplace l'ancien enum TypeScript figé `FareClass` (STANDARD/CONFORT/VIP/
 * STANDING). Chaque tenant peut créer ses propres classes ; les defaults
 * marché viennent de `pricing.defaults.fareClasses` (PlatformConfigService).
 *
 * Les classes créées au provisioning ont `isSystemDefault=true` et ne peuvent
 * pas être supprimées (seulement désactivées) — protection contre la suppression
 * accidentelle qui casserait la cohérence des tickets existants.
 */

export interface FareClassDefault {
  code:       string;
  labelKey:   string;
  multiplier: number;
  sortOrder:  number;
  color?:     string;
}

export interface CreateTenantFareClassDto {
  code:       string;
  label:      string;
  labelKey?:  string;
  multiplier: number;
  sortOrder?: number;
  color?:     string;
  enabled?:   boolean;
}

export type UpdateTenantFareClassDto = Partial<CreateTenantFareClassDto>;

@Injectable()
export class TenantFareClassService {
  constructor(
    private readonly prisma:         PrismaService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  list(tenantId: string) {
    return this.prisma.tenantFareClass.findMany({
      where:   { tenantId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Liste filtrée aux classes actives — consommée par PageSellTicket et le
   * portail voyageur pour proposer les classes à la vente.
   */
  listEnabled(tenantId: string) {
    return this.prisma.tenantFareClass.findMany({
      where:   { tenantId, enabled: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateTenantFareClassDto) {
    this.validate(dto);
    try {
      return await this.prisma.tenantFareClass.create({
        data: {
          tenantId,
          code:            dto.code.trim().toUpperCase(),
          label:           dto.label.trim(),
          labelKey:        dto.labelKey,
          multiplier:      dto.multiplier,
          sortOrder:       dto.sortOrder ?? 0,
          color:           dto.color,
          enabled:         dto.enabled ?? true,
          isSystemDefault: false,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new BadRequestException(`Classe ${dto.code} déjà définie pour ce tenant`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateTenantFareClassDto) {
    const existing = await this.prisma.tenantFareClass.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Classe ${id} introuvable`);
    this.validate({ ...existing, ...dto } as CreateTenantFareClassDto);
    if (existing.isSystemDefault && 'code' in dto) {
      throw new BadRequestException('Le code d\'une classe système ne peut pas être modifié');
    }
    const res = await this.prisma.tenantFareClass.updateMany({
      where: { id, tenantId },
      data: {
        ...('code'       in dto ? { code: dto.code!.trim().toUpperCase() }                          : {}),
        ...('label'      in dto ? { label: dto.label!.trim() }                                      : {}),
        ...('labelKey'   in dto ? { labelKey: dto.labelKey ?? null }                                : {}),
        ...('multiplier' in dto ? { multiplier: dto.multiplier! }                                   : {}),
        ...('sortOrder'  in dto ? { sortOrder: dto.sortOrder! }                                     : {}),
        ...('color'      in dto ? { color: dto.color ?? null }                                      : {}),
        ...('enabled'    in dto ? { enabled: dto.enabled! }                                         : {}),
      },
    });
    if (res.count === 0) throw new NotFoundException(`Classe ${id} introuvable`);
    return this.prisma.tenantFareClass.findFirst({ where: { id, tenantId } });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.tenantFareClass.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`Classe ${id} introuvable`);
    if (existing.isSystemDefault) {
      throw new BadRequestException(
        'Impossible de supprimer une classe système. Désactivez-la via `enabled=false` si besoin.',
      );
    }
    const res = await this.prisma.tenantFareClass.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Classe ${id} introuvable`);
    return { ok: true };
  }

  /**
   * Seed idempotent des classes par défaut pour un tenant.
   * Lit la liste depuis `pricing.defaults.fareClasses` (PlatformConfig).
   *
   * Retourne le nombre de classes créées (skippées si déjà présentes).
   * Utilisé par OnboardingService (au provisioning) et par le script
   * pricing-defaults.backfill (rattrapage des tenants existants).
   */
  async seedDefaults(tenantId: string): Promise<{ created: number; skipped: number }> {
    const defaults = await this.platformConfig.getJson<FareClassDefault[]>('pricing.defaults.fareClasses');
    if (!Array.isArray(defaults)) {
      throw new Error('pricing.defaults.fareClasses doit être un array (vérifier platform-config.registry.ts)');
    }

    let created = 0;
    let skipped = 0;

    for (const def of defaults) {
      const existing = await this.prisma.tenantFareClass.findFirst({
        where: { tenantId, code: def.code },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await this.prisma.tenantFareClass.create({
        data: {
          tenantId,
          code:            def.code,
          label:           def.code, // fallback ; le UI préfère labelKey
          labelKey:        def.labelKey,
          multiplier:      def.multiplier,
          sortOrder:       def.sortOrder,
          color:           def.color,
          enabled:         true,
          isSystemDefault: true,
        },
      });
      created++;
    }

    return { created, skipped };
  }

  /**
   * Résout un code de classe vers son multiplicateur pour un tenant donné.
   * Utilisé par PricingEngine — remplace l'ancien lookup `rules.fareMultipliers[code]`.
   * Retourne 1.0 (no-op) si la classe n'existe pas, pour ne pas bloquer une vente
   * sur un incohérence de donnée (l'admin peut corriger après).
   */
  async getMultiplier(tenantId: string, code: string): Promise<number> {
    const fc = await this.prisma.tenantFareClass.findFirst({
      where: { tenantId, code: code.toUpperCase(), enabled: true },
    });
    return fc?.multiplier ?? 1.0;
  }

  private validate(dto: CreateTenantFareClassDto): void {
    if (!dto.code?.trim())    throw new BadRequestException('code requis');
    if (!dto.label?.trim())   throw new BadRequestException('label requis');
    if (typeof dto.multiplier !== 'number' || !Number.isFinite(dto.multiplier) || dto.multiplier <= 0) {
      throw new BadRequestException('multiplier doit être un nombre strictement positif');
    }
    if (dto.multiplier > 10) {
      throw new BadRequestException('multiplier doit être ≤ 10 (garde-fou anti-saisie erronée)');
    }
  }
}
