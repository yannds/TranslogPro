import {
  Controller, Get, Post, Patch, Param, Body, Query,
} from '@nestjs/common';
import {
  QhseService,
  CreateAccidentReportDto,
  UpdateAccidentReportDto,
  AddThirdPartyDto,
  AddInjuryDto,
  AddMedicalFollowUpDto,
  OpenDisputeDto,
  UpdateDisputeDto,
  AddDisputeExpenseDto,
  CreateQhseProcedureDto,
  ExecuteStepDto,
} from './qhse.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireModule }     from '../../common/decorators/require-module.decorator';
import { TenantId }          from '../../common/decorators/tenant-id.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { Permission }        from '../../common/constants/permissions';

@RequireModule('QHSE')
@Controller('tenants/:tenantId/qhse')
export class QhseController {
  constructor(private readonly svc: QhseService) {}

  // ── Severity Types ─────────────────────────────────────────────────────────

  @Post('severity-types')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  createSeverityType(
    @TenantId() tenantId: string,
    @Body() body: {
      name: string; code: string; color?: string;
      requiresQhse?: boolean; requiresPolice?: boolean; requiresInsurer?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.svc.createSeverityType(tenantId, body);
  }

  @Get('severity-types')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  listSeverityTypes(@TenantId() tenantId: string) {
    return this.svc.listSeverityTypes(tenantId);
  }

  // ── Accident Reports ───────────────────────────────────────────────────────

  @Post('accidents')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  createAccidentReport(
    @TenantId() tenantId: string,
    @Body() dto: CreateAccidentReportDto,
  ) {
    return this.svc.createAccidentReport(tenantId, dto);
  }

  @Patch('accidents/:id')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  updateAccidentReport(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccidentReportDto,
  ) {
    return this.svc.updateAccidentReport(tenantId, id, dto);
  }

  @Get('accidents/:id')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  getAccidentReport(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.getAccidentReport(tenantId, id, scope);
  }

  @Get('accidents')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  listAccidentReports(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
    @Query('busId')  busId?: string,
    @Query('from')   from?: string,
    @Query('to')     to?: string,
  ) {
    return this.svc.listAccidentReports(tenantId, { status, busId, from, to });
  }

  @Post('accidents/:id/photo-url')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  getAccidentPhotoUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() body: { filename: string },
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.getAccidentPhotoUploadUrl(tenantId, id, body.filename, scope);
  }

  // ── Third Parties ──────────────────────────────────────────────────────────

  @Post('accidents/:id/third-parties')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  addThirdParty(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddThirdPartyDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.addThirdParty(tenantId, id, dto, scope);
  }

  @Post('third-parties/:id/statement-url')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  getThirdPartyStatementUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.getThirdPartyStatementUploadUrl(tenantId, id, scope);
  }

  // ── Injuries ───────────────────────────────────────────────────────────────

  @Post('accidents/:id/injuries')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  addInjury(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddInjuryDto,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.svc.addInjury(tenantId, id, dto, scope);
  }

  @Post('injuries/:id/follow-ups')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  addMedicalFollowUp(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddMedicalFollowUpDto,
  ) {
    return this.svc.addMedicalFollowUp(tenantId, id, dto);
  }

  @Post('follow-ups/:id/upload-url')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  getMedicalFollowUpUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getMedicalFollowUpUploadUrl(tenantId, id);
  }

  // ── Hospitals ──────────────────────────────────────────────────────────────

  @Post('hospitals')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  createHospital(
    @TenantId() tenantId: string,
    @Body() dto: { name: string; city: string; address?: string; phone?: string; gpsLat?: number; gpsLng?: number },
  ) {
    return this.svc.createHospital(tenantId, dto);
  }

  @Get('hospitals')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  listHospitals(@TenantId() tenantId: string) {
    return this.svc.listHospitals(tenantId);
  }

  // ── Disputes ───────────────────────────────────────────────────────────────

  @Post('accidents/:id/dispute')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  openDispute(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.svc.openDispute(tenantId, id, dto);
  }

  @Patch('disputes/:id')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  updateDispute(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDisputeDto,
  ) {
    return this.svc.updateDispute(tenantId, id, dto);
  }

  @Post('disputes/:id/expenses')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  addDisputeExpense(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddDisputeExpenseDto,
  ) {
    return this.svc.addDisputeExpense(tenantId, id, dto);
  }

  @Post('dispute-expenses/:id/upload-url')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  getDisputeExpenseUploadUrl(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getDisputeExpenseUploadUrl(tenantId, id);
  }

  @Get('disputes/:id/summary')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  getDisputeSummary(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getDisputeSummary(tenantId, id);
  }

  // ── QHSE Procedures ────────────────────────────────────────────────────────

  @Post('procedures')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  createProcedure(
    @TenantId() tenantId: string,
    @Body() dto: CreateQhseProcedureDto,
  ) {
    return this.svc.createProcedure(tenantId, dto);
  }

  @Get('procedures')
  @RequirePermission(Permission.QHSE_MANAGE_TENANT)
  listProcedures(@TenantId() tenantId: string) {
    return this.svc.listProcedures(tenantId);
  }

  @Post('procedures/execute')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  startExecution(
    @TenantId() tenantId: string,
    @Body() dto: { reportId: string; procedureId: string; startedById: string },
  ) {
    return this.svc.startProcedureExecution(tenantId, dto);
  }

  @Post('executions/:id/steps')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  executeStep(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: ExecuteStepDto,
  ) {
    return this.svc.executeStep(tenantId, id, dto);
  }

  @Get('executions/:id')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  getExecution(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.svc.getExecution(tenantId, id);
  }

  @Post('executions/:executionId/steps/:stepId/photo-url')
  @RequirePermission(Permission.ACCIDENT_REPORT_OWN)
  getStepPhotoUrl(
    @TenantId() tenantId: string,
    @Param('executionId') executionId: string,
    @Param('stepId')      stepId: string,
  ) {
    return this.svc.getStepPhotoUploadUrl(tenantId, executionId, stepId);
  }
}
