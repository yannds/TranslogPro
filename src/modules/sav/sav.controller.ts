import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { SavService, CreateClaimDto } from './sav.service';
import { RefundService } from './refund.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/sav')
export class SavController {
  constructor(
    private readonly savService: SavService,
    private readonly refundService: RefundService,
  ) {}

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
    @Body('decision') decision: 'RESOLVE' | 'REJECT',
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.savService.process(tenantId, id, decision, actor);
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

  // ── Refunds ───────────────────────────────────────────────────────────────

  @Get('refunds')
  @RequirePermission(Permission.REFUND_READ_AGENCY)
  findAllRefunds(@TenantId() tenantId: string, @Query('status') status?: string) {
    return this.refundService.findAll(tenantId, status);
  }

  @Get('refunds/:id')
  @RequirePermission(Permission.REFUND_READ_AGENCY)
  findOneRefund(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.refundService.findOne(tenantId, id);
  }

  /**
   * Approbation remboursement — dual scope.
   * Permission minimum : data.refund.approve.agency (le service vérifie le seuil
   * et refuse si le montant dépasse le plafond agence pour les non-admin).
   */
  @Post('refunds/:id/approve')
  @RequirePermission(Permission.REFUND_APPROVE_AGENCY)
  approveRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.refundService.approve(tenantId, id, actor);
  }

  @Post('refunds/:id/process')
  @RequirePermission(Permission.REFUND_PROCESS_TENANT)
  processRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.refundService.process(tenantId, id, actor);
  }

  @Post('refunds/:id/reject')
  @RequirePermission(Permission.REFUND_APPROVE_AGENCY)
  rejectRefund(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('notes') notes: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.refundService.reject(tenantId, id, actor, notes);
  }
}
