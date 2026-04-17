import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import {
  DriverProfileService,
  CreateDriverLicenseDto,
  UpdateDriverLicenseDto,
  StartRestPeriodDto,
  EndRestPeriodDto,
  CreateTrainingTypeDto,
  ScheduleTrainingDto,
  CompleteTrainingDto,
  CreateRemediationRuleDto,
} from './driver-profile.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { TenantId }          from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }        from '../../common/constants/permissions';

// Module DRIVER_PROFILE rendu obligatoire (socle conformité — temps de repos,
// licences, formations). Pas de @RequireModule : toutes les routes sont
// toujours actives, la seule protection reste la permission.
@Controller('tenants/:tenantId/driver-profile')
export class DriverProfileController {
  constructor(private readonly svc: DriverProfileService) {}

  // ── Rest Configuration ─────────────────────────────────────────────────────

  @Get('rest-config')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.DRIVER_REST_OWN])
  getRestConfig(@TenantId() tenantId: string) {
    return this.svc.getRestConfig(tenantId);
  }

  @Patch('rest-config')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  updateRestConfig(
    @TenantId() tenantId: string,
    @Body() dto: {
      minRestMinutes?: number;
      maxDrivingMinutesPerDay?: number;
      maxDrivingMinutesPerWeek?: number;
      alertBeforeEndRestMin?: number;
    },
  ) {
    return this.svc.updateRestConfig(tenantId, dto);
  }

  // ── Licenses ───────────────────────────────────────────────────────────────

  @Post('licenses')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  createLicense(
    @TenantId() tenantId: string,
    @Body() dto: CreateDriverLicenseDto,
  ) {
    return this.svc.createLicense(tenantId, dto);
  }

  @Patch('licenses/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  updateLicense(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDriverLicenseDto,
  ) {
    return this.svc.updateLicense(tenantId, id, dto);
  }

  @Delete('licenses/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  deleteLicense(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.deleteLicense(tenantId, id);
  }

  @Get('drivers/:staffId/licenses')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.DRIVER_REST_OWN])
  getLicensesForDriver(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.svc.getLicensesForDriver(tenantId, staffId);
  }

  @Post('licenses/:id/upload-url')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  getLicenseUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getLicenseUploadUrl(tenantId, id);
  }

  @Get('licenses')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getAllLicenses(@TenantId() tenantId: string) {
    return this.svc.getAllLicenses(tenantId);
  }

  @Get('licenses/alerts')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getLicenseAlerts(@TenantId() tenantId: string) {
    return this.svc.getLicenseAlerts(tenantId);
  }

  // ── Rest Periods ───────────────────────────────────────────────────────────

  @Get('drivers/:staffId/rest-compliance')
  // .agency en 1er (plus large — pour managers), .own en 2e (chauffeur lisant
  // ses propres données). Le service rejette le cross-user quand scope=own.
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.DRIVER_REST_OWN])
  checkRestCompliance(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.checkRestCompliance(tenantId, staffId, scope);
  }

  @Post('rest-periods')
  @RequirePermission(Permission.DRIVER_REST_OWN)
  startRestPeriod(
    @TenantId() tenantId: string,
    @Body() dto: StartRestPeriodDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.startRestPeriod(tenantId, dto, scope);
  }

  @Patch('rest-periods/:id/end')
  @RequirePermission(Permission.DRIVER_REST_OWN)
  endRestPeriod(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: EndRestPeriodDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.endRestPeriod(tenantId, id, dto, scope);
  }

  @Get('drivers/:staffId/rest-history')
  @RequirePermission([Permission.DRIVER_PROFILE_AGENCY, Permission.DRIVER_REST_OWN])
  getRestHistory(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
    @Query('limit') limit?: string,
    @ScopeCtx() scope?: ScopeContext,
  ) {
    return this.svc.getRestHistory(tenantId, staffId, limit ? parseInt(limit, 10) : undefined, scope);
  }

  // ── Training Types ─────────────────────────────────────────────────────────

  @Post('training-types')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  createTrainingType(
    @TenantId() tenantId: string,
    @Body() dto: CreateTrainingTypeDto,
  ) {
    return this.svc.createTrainingType(tenantId, dto);
  }

  @Get('training-types')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  listTrainingTypes(@TenantId() tenantId: string) {
    return this.svc.listTrainingTypes(tenantId);
  }

  // ── Trainings ──────────────────────────────────────────────────────────────

  @Post('trainings')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  scheduleTraining(
    @TenantId() tenantId: string,
    @Body() dto: ScheduleTrainingDto,
  ) {
    return this.svc.scheduleTraining(tenantId, dto);
  }

  @Patch('trainings/:id/complete')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  completeTraining(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CompleteTrainingDto,
  ) {
    return this.svc.completeTraining(tenantId, id, dto);
  }

  @Delete('trainings/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  deleteTraining(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.deleteTraining(tenantId, id);
  }

  @Post('trainings/:id/upload-url')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  getTrainingUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getTrainingUploadUrl(tenantId, id);
  }

  @Get('drivers/:staffId/trainings')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getTrainingsForDriver(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.svc.getTrainingsForDriver(tenantId, staffId);
  }

  @Get('trainings/overdue')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getOverdueTrainings(@TenantId() tenantId: string) {
    return this.svc.getOverdueTrainings(tenantId);
  }

  // ── Remediation ────────────────────────────────────────────────────────────

  @Post('remediation-rules')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  createRemediationRule(
    @TenantId() tenantId: string,
    @Body() dto: CreateRemediationRuleDto,
  ) {
    return this.svc.createRemediationRule(tenantId, dto);
  }

  @Get('remediation-rules')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  listRemediationRules(@TenantId() tenantId: string) {
    return this.svc.listRemediationRules(tenantId);
  }

  @Patch('remediation-rules/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  updateRemediationRule(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateRemediationRuleDto> & { isActive?: boolean },
  ) {
    return this.svc.updateRemediationRule(tenantId, id, dto);
  }

  @Delete('remediation-rules/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  deleteRemediationRule(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.deleteRemediationRule(tenantId, id);
  }

  @Post('drivers/:staffId/remediation/evaluate')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  evaluateRemediation(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
    @Body() body: { score: number },
  ) {
    return this.svc.evaluateRemediationForDriver(tenantId, staffId, body.score);
  }

  @Get('drivers/:staffId/remediation/actions')
  @RequirePermission(Permission.DRIVER_PROFILE_AGENCY)
  getRemediationActions(
    @TenantId() tenantId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.svc.getRemediationActionsForDriver(tenantId, staffId);
  }

  @Patch('remediation/actions/:id')
  @RequirePermission(Permission.DRIVER_MANAGE_TENANT)
  updateRemediationAction(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: { status: string; completedAt?: string; notes?: string },
  ) {
    return this.svc.updateRemediationAction(tenantId, id, dto);
  }
}
