/**
 * PricingController — Endpoints rentabilité & yield.
 *
 * Routes :
 *   GET    /api/v1/tenants/:tid/buses/:busId/cost-profile
 *   PUT    /api/v1/tenants/:tid/buses/:busId/cost-profile
 *   GET    /api/v1/tenants/:tid/trips/:tripId/cost-snapshot
 *   POST   /api/v1/tenants/:tid/trips/:tripId/cost-snapshot   — déclenche le calcul manuellement
 *   GET    /api/v1/tenants/:tid/trips/:tripId/yield            — suggère un prix
 *   GET    /api/v1/tenants/:tid/analytics/profitability        — dashboard décideur
 */
import {
  Controller, Get, Put, Post, Param, Body, Query,
} from '@nestjs/common';
import { ProfitabilityService }   from './profitability.service';
import { YieldService }           from './yield.service';
import { UpsertBusCostProfileDto } from './dto/bus-cost-profile.dto';
import { RequirePermission }      from '../../common/decorators/require-permission.decorator';
import { Permission }             from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class PricingController {
  constructor(
    private readonly profitability: ProfitabilityService,
    private readonly yield_:        YieldService,
  ) {}

  // ── Profils de coût ──────────────────────────────────────────────────────────

  @Get('buses/:busId/cost-profile')
  @RequirePermission(Permission.PRICING_MANAGE_TENANT)
  getCostProfile(
    @Param('tenantId') tenantId: string,
    @Param('busId')    busId:    string,
  ) {
    return this.profitability.getCostProfile(tenantId, busId);
  }

  @Put('buses/:busId/cost-profile')
  @RequirePermission(Permission.PRICING_MANAGE_TENANT)
  upsertCostProfile(
    @Param('tenantId') tenantId: string,
    @Param('busId')    busId:    string,
    @Body() dto: UpsertBusCostProfileDto,
  ) {
    return this.profitability.upsertCostProfile(tenantId, busId, dto);
  }

  // ── Snapshots par trajet ─────────────────────────────────────────────────────

  @Get('trips/:tripId/cost-snapshot')
  @RequirePermission(Permission.PRICING_READ_AGENCY)
  getCostSnapshot(
    @Param('tenantId') tenantId: string,
    @Param('tripId')   tripId:   string,
  ) {
    return this.profitability.computeAndSnapshot(tenantId, tripId);
  }

  @Post('trips/:tripId/cost-snapshot')
  @RequirePermission(Permission.PRICING_MANAGE_TENANT)
  triggerCostSnapshot(
    @Param('tenantId') tenantId: string,
    @Param('tripId')   tripId:   string,
  ) {
    return this.profitability.computeAndSnapshot(tenantId, tripId);
  }

  // ── Yield ────────────────────────────────────────────────────────────────────

  @Get('trips/:tripId/yield')
  @RequirePermission(Permission.PRICING_YIELD_TENANT)
  getYieldSuggestion(
    @Param('tenantId') tenantId: string,
    @Param('tripId')   tripId:   string,
  ) {
    return this.yield_.calculateSuggestedPrice(tenantId, tripId);
  }

  // ── Dashboard décideur ───────────────────────────────────────────────────────

  @Get('analytics/profitability')
  @RequirePermission(Permission.PRICING_MANAGE_TENANT)
  getProfitabilitySummary(
    @Param('tenantId') tenantId: string,
    @Query('from') from: string,
    @Query('to')   to:   string,
  ) {
    const fromDate = new Date(from ?? new Date(Date.now() - 30 * 86_400_000));
    const toDate   = new Date(to   ?? new Date());
    return this.profitability.getProfitabilitySummary(tenantId, fromDate, toDate);
  }
}
