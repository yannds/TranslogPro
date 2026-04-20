import { Controller, Get, Param, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { AuditService } from '../../core/workflow/audit.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

// Pas de magic number inline — plafonds d'export explicites.
const MAX_EXPORT_DAYS = 92;
const MAX_EXPORT_ROWS = 50_000;
const ONE_DAY_MS      = 24 * 60 * 60 * 1_000;

@Controller('tenants/:tenantId/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly audit:             AuditService,
  ) {}

  @Get('dashboard')
  @RequirePermission(Permission.STATS_READ_TENANT)
  dashboard(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
  ) {
    // scope.scope='agency' → l'acteur ne voit que son agence, peu importe le query param
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getDashboard(tenantId, effectiveAgencyId);
  }

  /**
   * KPIs lean du jour — consommé par l'app mobile admin (payload <1 KB).
   * Scope .agency forcé si l'acteur est AGENCY_MANAGER (vue restreinte).
   */
  @Get('kpis')
  @RequirePermission(Permission.STATS_READ_TENANT)
  kpis(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getKpis(tenantId, effectiveAgencyId);
  }

  @Get('trips')
  @RequirePermission(Permission.STATS_READ_TENANT)
  tripsReport(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getTripsReport(
      tenantId, new Date(from), new Date(to), effectiveAgencyId,
    );
  }

  @Get('revenue')
  @RequirePermission(Permission.STATS_READ_TENANT)
  revenueReport(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getRevenueReport(
      tenantId, new Date(from), new Date(to), effectiveAgencyId,
    );
  }

  @Get('trips/:tripId/occupancy')
  @RequirePermission(Permission.STATS_READ_TENANT)
  occupancy(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.analyticsService.getOccupancyRate(tenantId, tripId);
  }

  /**
   * Dashboard exécutif "Aujourd'hui" (Sprint 4) — agrège KPI jour + série 7j +
   * seuils + flags d'alerte en un seul appel pour PageDashboard/Exec.
   * Scope agency respecté pour AGENCY_MANAGER.
   */
  @Get('today-summary')
  @RequirePermission(Permission.STATS_READ_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'userId', suffix: 'analytics_today',
    message: 'Too many dashboard refresh requests.',
  })
  todaySummary(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('agencyId') agencyId?: string,
  ) {
    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;
    return this.analyticsService.getTodaySummary(tenantId, effectiveAgencyId);
  }

  /**
   * Segmentation client par activité (voyageur / expéditeur / les deux).
   * Source de vérité : tables Ticket + Parcel — pas le rôle.
   */
  @Get('customer-segmentation')
  @RequirePermission(Permission.STATS_READ_TENANT)
  customerSegmentation(@TenantId() tenantId: string) {
    return this.analyticsService.getCustomerSegmentation(tenantId);
  }

  @Get('top-routes')
  @RequirePermission(Permission.STATS_READ_TENANT)
  topRoutes(
    @TenantId() tenantId: string,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getTopRoutes(
      tenantId, new Date(from), new Date(to), limit ? parseInt(limit, 10) : 10,
    );
  }

  /**
   * Export CSV tickets — plafonné (fenêtre + nb lignes) et audité.
   * Rate-limit 10/h/userId pour éviter les scripts de dump.
   */
  @Get('export/tickets')
  @RequirePermission(Permission.STATS_READ_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    10,
    windowMs: 60 * 60 * 1_000,
    keyBy:    'userId',
    suffix:   'analytics_export_tickets',
    message:  'Limite d\'exports atteinte (10/h). Réessayez plus tard.',
  })
  async exportTickets(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @CurrentUser() actor: CurrentUserPayload,
    @Res() res: Response,
    @Query('from') from: string,
    @Query('to')   to: string,
    @Query('agencyId') agencyId?: string,
  ) {
    if (!from || !to) throw new BadRequestException('from/to obligatoires');
    const f = new Date(from);
    const t = new Date(to);
    if (isNaN(f.getTime()) || isNaN(t.getTime())) throw new BadRequestException('Dates invalides');
    if (t.getTime() <= f.getTime())              throw new BadRequestException('to doit être > from');
    const days = Math.ceil((t.getTime() - f.getTime()) / ONE_DAY_MS);
    if (days > MAX_EXPORT_DAYS) throw new BadRequestException(`Fenêtre max = ${MAX_EXPORT_DAYS} jours`);

    const effectiveAgencyId = scope.scope === 'agency' ? scope.agencyId : agencyId;

    const csv = await this.analyticsService.exportTicketsCsv(
      tenantId, effectiveAgencyId, f, t, MAX_EXPORT_ROWS,
    );

    // Audit : export tracé (valeur + fenêtre + scope) — obligatoire RGPD.
    await this.audit.record({
      tenantId,
      userId:   actor.id,
      action:   'data.analytics.export.tenant',
      resource: `TicketsCsv:${f.toISOString()}..${t.toISOString()}`,
      newValue: { days, agencyId: effectiveAgencyId ?? null, bytes: csv.length },
      plane: 'data', level: 'warn',
    });

    const filename = `tickets-${f.toISOString().slice(0, 10)}-${t.toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type',        'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
