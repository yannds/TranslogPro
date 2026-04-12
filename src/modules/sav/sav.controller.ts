import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { SavService, CreateClaimDto } from './sav.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/sav')
export class SavController {
  constructor(private readonly savService: SavService) {}

  /**
   * Déclaration objet trouvé par chauffeur — scope own.
   * PRD §IV.6 : data.sav.report.own
   */
  @Post('lost-found')
  @RequirePermission(Permission.SAV_REPORT_OWN)
  reportLostFound(
    @TenantId() tenantId: string,
    @Body() dto: CreateClaimDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.savService.createClaim(tenantId, dto, actor);
  }

  /**
   * Enregistrement objet trouvé par agent de gare — scope agency.
   * PRD §IV.5 : data.sav.report.agency
   */
  @Post('claims')
  @RequirePermission(Permission.SAV_REPORT_AGENCY)
  createClaim(
    @TenantId() tenantId: string,
    @Body() dto: CreateClaimDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.savService.createClaim(tenantId, dto, actor);
  }

  @Get('claims')
  @RequirePermission(Permission.SAV_CLAIM_TENANT)
  findAll(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.savService.findAll(tenantId, status);
  }

  @Get('claims/:id')
  @RequirePermission(Permission.SAV_REPORT_AGENCY)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.savService.findOne(tenantId, id);
  }

  /**
   * Traitement réclamation (approbation / rejet) — scope tenant.
   * PRD §IV.5 : data.sav.claim.tenant
   */
  @Patch('claims/:id/process')
  @RequirePermission(Permission.SAV_CLAIM_TENANT)
  process(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('decision') decision: 'APPROVED' | 'REJECTED',
    @Body('notes') notes: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.savService.process(tenantId, id, decision, notes, actor);
  }

  /**
   * Remise physique objet — scope agency.
   * PRD §IV.5 : data.sav.deliver.agency — URL pièce d'identité 15min TTL.
   */
  @Post('claims/:id/deliver')
  @RequirePermission(Permission.SAV_DELIVER_AGENCY)
  deliver(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.savService.getIdPhotoUploadUrl(tenantId, id);
  }
}
