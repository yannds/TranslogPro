/**
 * PricingController — Endpoints rentabilité & yield.
 *
 * Routes :
 *   GET    /api/tenants/:tid/buses/:busId/cost-profile
 *   PUT    /api/tenants/:tid/buses/:busId/cost-profile
 *   GET    /api/tenants/:tid/trips/:tripId/cost-snapshot
 *   POST   /api/tenants/:tid/trips/:tripId/cost-snapshot   — déclenche le calcul manuellement
 *   GET    /api/tenants/:tid/trips/:tripId/yield            — suggère un prix
 *   GET    /api/tenants/:tid/analytics/profitability        — dashboard décideur
 */
import {
  Controller, Get, Put, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import { ProfitabilityService }   from './profitability.service';
import { YieldService }           from './yield.service';
import { PeakPeriodService, CreatePeakPeriodDto, UpdatePeakPeriodDto } from './peak-period.service';
import { PricingSimulatorAdvancedService } from './simulator-advanced.service';
import { UpsertBusCostProfileDto } from './dto/bus-cost-profile.dto';
import { RequirePermission }      from '../../common/decorators/require-permission.decorator';
import { Permission }             from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class PricingController {
  constructor(
    private readonly profitability: ProfitabilityService,
    private readonly yield_:        YieldService,
    private readonly peakPeriods:   PeakPeriodService,
    private readonly advanced:      PricingSimulatorAdvancedService,
  ) {}

  // ── Périodes peak (calendrier yield) — Sprint 5 ─────────────────────────
  @Get('peak-periods')
  @RequirePermission(Permission.PEAK_PERIOD_READ_TENANT)
  listPeakPeriods(@Param('tenantId') tenantId: string) {
    return this.peakPeriods.list(tenantId);
  }

  @Post('peak-periods')
  @RequirePermission(Permission.PEAK_PERIOD_MANAGE_TENANT)
  createPeakPeriod(@Param('tenantId') tenantId: string, @Body() dto: CreatePeakPeriodDto) {
    return this.peakPeriods.create(tenantId, dto);
  }

  @Patch('peak-periods/:id')
  @RequirePermission(Permission.PEAK_PERIOD_MANAGE_TENANT)
  updatePeakPeriod(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body()            dto:      UpdatePeakPeriodDto,
  ) {
    return this.peakPeriods.update(tenantId, id, dto);
  }

  @Delete('peak-periods/:id')
  @RequirePermission(Permission.PEAK_PERIOD_MANAGE_TENANT)
  removePeakPeriod(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.peakPeriods.remove(tenantId, id);
  }

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

  /**
   * Simulation pré-trajet (Sprint 11.A) — le gestionnaire saisit route + bus +
   * prix envisagé + fillRate estimé, et reçoit :
   *   · Coûts détaillés + marge estimée
   *   · Tag PROFITABLE / BREAK_EVEN / DEFICIT
   *   · Prix break-even / profitable au fillRate fourni
   *   · fillRate break-even / profitable au prix fourni
   *   · Message d'orientation factuel (non-bloquant)
   *
   * Permission granulaire : `data.profitability.read.tenant`.
   * Par défaut mappée sur TENANT_ADMIN, AGENCY_MANAGER, ACCOUNTANT (admins qui
   * programment des trajets ou auditent la rentabilité).
   */
  @Post('simulate-trip')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simulateTrip(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; busId: string; ticketPrice?: number; fillRate?: number },
  ) {
    return this.profitability.simulateTrip(tenantId, dto);
  }

  // ── Simulateur avancé — 7 outils d'aide à la décision ────────────────────
  // Toutes les méthodes partagent la permission `data.profitability.read.tenant`.
  // Elles sont déclenchées par /admin/pricing/simulator (PagePricingSimulator).

  @Post('simulator/sensitivity-matrix')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simMatrix(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; busId: string; centerPrice?: number },
  ) { return this.advanced.sensitivityMatrix(tenantId, dto); }

  @Post('simulator/price-bands')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simBands(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; busId: string; fillRate?: number },
  ) { return this.advanced.priceBands(tenantId, dto); }

  @Post('simulator/historical-benchmark')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simHistorical(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; days?: number },
  ) { return this.advanced.historicalBenchmark(tenantId, dto); }

  @Post('simulator/analyze-competitor')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simCompetitor(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; busId: string; competitorPrice: number; fillRate?: number },
  ) { return this.advanced.analyzeCompetitor(tenantId, dto); }

  @Post('simulator/what-if')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simWhatIf(
    @Param('tenantId') tenantId: string,
    @Body() dto: {
      routeId: string; busId: string;
      ticketPrice?: number; fillRate?: number;
      fuelDeltaPct?: number; commissionRate?: number;
    },
  ) { return this.advanced.simulateWhatIf(tenantId, dto); }

  @Post('simulator/compare-routes')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simCompare(
    @Param('tenantId') tenantId: string,
    @Body() dto: { fillRate?: number },
  ) { return this.advanced.compareRoutes(tenantId, dto); }

  @Post('simulator/monthly-break-even')
  @RequirePermission(Permission.PROFITABILITY_READ_TENANT)
  simMonthlyBE(
    @Param('tenantId') tenantId: string,
    @Body() dto: { routeId: string; busId: string; ticketPrice?: number; fillRate?: number },
  ) { return this.advanced.monthlyBreakEven(tenantId, dto); }

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
