import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { SafetyService, ReportAlertDto } from './safety.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/safety')
export class SafetyController {
  constructor(private readonly safetyService: SafetyService) {}

  /** Signalement in-app (voyageur, chauffeur) */
  @Post('alerts')
  @RequirePermission(Permission.FEEDBACK_SUBMIT_OWN)
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
