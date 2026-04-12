import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SafetyService, ReportAlertDto } from './safety.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

@Controller('tenants/:tenantId/safety')
export class SafetyController {
  constructor(private readonly safetyService: SafetyService) {}

  /**
   * Signalement in-app (voyageur, chauffeur).
   * Rate limit : 10 alertes / heure / userId (PRD §IV.13)
   */
  @Post('alerts')
  @RequirePermission(Permission.FEEDBACK_SUBMIT_OWN)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    10,
    windowMs: 60 * 60 * 1_000,
    keyBy:    'userId',
    suffix:   'safety_alert',
    message:  'Limite de signalements atteinte (10/heure).',
  })
  report(
    @TenantId() tenantId: string,
    @Body() dto: ReportAlertDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.safetyService.reportAlert(tenantId, dto, actor);
  }

  /** Dashboard Dispatch — toutes les alertes en cours */
  @Get('alerts')
  @RequirePermission(Permission.SAFETY_MONITOR_GLOBAL)
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.safetyService.listAlerts(tenantId, status);
  }

  @Patch('alerts/:id/dismiss')
  @RequirePermission(Permission.SAFETY_MONITOR_GLOBAL)
  dismiss(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.safetyService.dismiss(tenantId, id);
  }
}
