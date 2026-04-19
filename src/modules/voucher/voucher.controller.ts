import { Controller, Get, Post, Delete, Patch, Param, Body, Query } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId/vouchers' })
export class VoucherController {
  constructor(private readonly vouchers: VoucherService) {}

  /** Émission d'un voucher (MANUAL / GESTURE / PROMO). Les origines INCIDENT et
   *  MAJOR_DELAY sont émises automatiquement par IncidentCompensationService. */
  @Post()
  @RequirePermission([Permission.VOUCHER_ISSUE_TENANT, Permission.VOUCHER_ISSUE_AGENCY])
  issue(
    @TenantId() tenantId: string,
    @Body() dto: {
      customerId?: string;
      recipientEmail?: string;
      recipientPhone?: string;
      amount: number;
      currency: string;
      validityDays: number;
      usageScope?: string;
      routeId?: string;
      origin: 'PROMO' | 'MANUAL' | 'GESTURE';
      metadata?: Record<string, unknown>;
    },
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.vouchers.issue({ ...dto, tenantId, issuedBy: actor.id });
  }

  /** Application au guichet : code + ticket cible. */
  @Post('redeem')
  @RequirePermission(Permission.VOUCHER_REDEEM_AGENCY)
  redeem(
    @TenantId() tenantId: string,
    @Body() dto: { code: string; ticketId: string },
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.vouchers.redeem(tenantId, dto.code, dto.ticketId, actor);
  }

  /** Annulation (admin, avant utilisation). DELETE pour clients HTTP-compat,
   *  PATCH /cancel pour clients qui ne supportent pas DELETE + body. */
  @Delete(':id')
  @RequirePermission(Permission.VOUCHER_CANCEL_TENANT)
  cancelByDelete(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.vouchers.cancel(tenantId, id, reason, actor);
  }

  @Patch(':id/cancel')
  @RequirePermission(Permission.VOUCHER_CANCEL_TENANT)
  cancelByPatch(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.vouchers.cancel(tenantId, id, reason, actor);
  }

  /** Liste (admin). */
  @Get()
  @RequirePermission(Permission.VOUCHER_READ_TENANT)
  findAll(
    @TenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.vouchers.findAll(tenantId, status);
  }

  /** Mes bons (voyageur). */
  @Get('my')
  @RequirePermission(Permission.VOUCHER_READ_OWN)
  findMine(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    // Lookup customerId depuis userId — le service filtre sur customerId.
    // Si l'utilisateur n'a pas de Customer profile (customerId null), retourne vide.
    return this.vouchers.findByCustomer(tenantId, actor.id);
  }
}
