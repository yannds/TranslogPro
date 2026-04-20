/**
 * PlatformKpiController
 *
 *   GET /platform/kpi/north-star             North Star (% ops via SaaS)
 *   GET /platform/kpi/mrr                    MRR + expansion revenue (SA only)
 *   GET /platform/kpi/retention              Cohortes D7/D30/D90
 *   GET /platform/kpi/transactional          Tickets, GMV, trips, on-time
 *   GET /platform/kpi/adoption               DAU/MAU + modules
 *   GET /platform/kpi/activation             Funnel activation 4 étapes
 *   GET /platform/kpi/strategic              Actions/user/semaine, dépendance
 *
 * RBAC fine-grained (4 permissions) :
 *   - business  : MRR              → SUPER_ADMIN only
 *   - adoption  : adoption, activation, transactional (partiel), strategic
 *                 → SA + SUPPORT_L1 + SUPPORT_L2
 *   - retention : cohortes         → SA + SUPPORT_L2
 *   - ops       : non-business     → SA + L1 + L2
 *
 * Note : North Star, transactional, strategic utilisent `adoption` car ils
 * contiennent des métriques utiles à l'équipe support (pas de montants business).
 */
import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { PlatformKpiService } from './platform-kpi.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import type { NorthStarMode } from './platform-kpi.constants';
import { NORTH_STAR_MODES } from './platform-kpi.constants';

function parsePeriodDays(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  // Borne dure côté controller : 1..365j pour éviter de burner la DB
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function parseMode(raw: string | undefined): NorthStarMode {
  if (raw && (NORTH_STAR_MODES as readonly string[]).includes(raw)) return raw as NorthStarMode;
  return 'compared';
}

@Controller('platform/kpi')
export class PlatformKpiController {
  constructor(private readonly kpi: PlatformKpiService) {}

  // ─── North Star — accessible SA + L1 + L2 (donnée d'adoption stratégique) ─
  @Get('north-star')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  northStar(@Query('mode') mode?: string, @Query('days') days?: string) {
    return this.kpi.getNorthStar(parseMode(mode), parsePeriodDays(days, 30));
  }

  // ─── MRR Breakdown — SUPER_ADMIN only (données business sensibles) ────────
  @Get('mrr')
  @RequirePermission(Permission.PLATFORM_KPI_BUSINESS_READ_GLOBAL)
  mrr(@Query('days') days?: string) {
    return this.kpi.getMrrBreakdown(parsePeriodDays(days, 30));
  }

  // ─── Retention Cohorts — SA + L2 (investigation) ──────────────────────────
  @Get('retention')
  @RequirePermission(Permission.PLATFORM_KPI_RETENTION_READ_GLOBAL)
  retention(@Query('days') days?: string) {
    return this.kpi.getRetentionCohorts(parsePeriodDays(days, 90));
  }

  // ─── Transactional — accessible SA + L1 + L2 ──────────────────────────────
  // Contient le GMV qui est business-sensible → on masque GMV côté service
  // si l'appelant n'a que adoption (géré par controller via filtrage).
  @Get('transactional')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  transactional(@Query('days') days?: string) {
    return this.kpi.getTransactional(parsePeriodDays(days, 30));
  }

  // ─── Adoption — SA + L1 + L2 (repérer tenants sous-utilisant modules) ─────
  @Get('adoption')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  adoption(@Query('days') days?: string) {
    return this.kpi.getAdoptionBreakdown(parsePeriodDays(days, 30));
  }

  // ─── Activation Funnel — SA + L1 + L2 (identifier tenants bloqués) ────────
  @Get('activation')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  activation() {
    return this.kpi.getActivationFunnel();
  }

  // ─── Strategic — SA + L1 + L2 (dépendance SaaS, top tenants actifs) ───────
  @Get('strategic')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  strategic(@Query('days') days?: string) {
    return this.kpi.getStrategic(parsePeriodDays(days, 7));
  }

  // ─── Modules usage par tenant — SA + L1 + L2 ──────────────────────────────
  // Retourne pour chaque module du registry son état (installé / actif /
  // désactivé + qui/quand) et son usage agrégé sur la période (actionCount,
  // uniqueUsers, activeDays, lastUsedAt). Source : ModuleUsageDaily.
  @Get('modules/usage/:tenantId')
  @RequirePermission(Permission.PLATFORM_KPI_ADOPTION_READ_GLOBAL)
  modulesUsage(
    @Param('tenantId') tenantId: string,
    @Query('days')     days?:    string,
  ) {
    if (!tenantId || tenantId.length < 8) throw new BadRequestException('Invalid tenantId');
    return this.kpi.getModulesUsageForTenant(tenantId, parsePeriodDays(days, 30));
  }
}
