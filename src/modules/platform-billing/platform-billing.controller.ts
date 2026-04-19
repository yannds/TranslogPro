/**
 * PlatformBillingController
 *
 * Toutes les routes sont réservées aux agents du tenant plateforme
 * (permission control.platform.billing.manage.global).
 *
 *   GET    /platform/billing/subscriptions
 *   GET    /platform/billing/subscriptions/by-tenant/:tenantId
 *   POST   /platform/billing/subscriptions                  { tenantId, planId, ... }
 *   PATCH  /platform/billing/subscriptions/:id/plan         { planId }
 *   PATCH  /platform/billing/subscriptions/:id/status       { status, cancelReason? }
 *
 *   GET    /platform/billing/invoices?tenantId=&status=
 *   GET    /platform/billing/invoices/:id
 *   POST   /platform/billing/invoices                       { subscriptionId, ... }
 *   POST   /platform/billing/invoices/:id/issue
 *   POST   /platform/billing/invoices/:id/mark-paid         { paymentMethod?, paymentRef? }
 *   POST   /platform/billing/invoices/:id/void
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PlatformBillingService } from './platform-billing.service';
import {
  ChangeSubscriptionPlanDto,
  CreateInvoiceDto,
  CreateSubscriptionDto,
  ExtendTrialDto,
  MarkInvoicePaidDto,
  UpdateSubscriptionStatusDto,
} from './dto/billing.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('platform/billing')
@RequirePermission(Permission.PLATFORM_BILLING_MANAGE_GLOBAL)
export class PlatformBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  // ── Subscriptions ───────────────────────────────────────────────────────

  @Get('subscriptions')
  listSubscriptions() {
    return this.billing.listSubscriptions();
  }

  @Get('subscriptions/by-tenant/:tenantId')
  getByTenant(@Param('tenantId') tenantId: string) {
    return this.billing.getSubscriptionByTenant(tenantId);
  }

  @Post('subscriptions')
  createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.billing.createSubscription(dto);
  }

  @Patch('subscriptions/:id/plan')
  changePlan(@Param('id') id: string, @Body() dto: ChangeSubscriptionPlanDto) {
    return this.billing.changePlan(id, dto);
  }

  @Patch('subscriptions/:id/status')
  changeStatus(@Param('id') id: string, @Body() dto: UpdateSubscriptionStatusDto) {
    return this.billing.updateStatus(id, dto);
  }

  @Patch('subscriptions/:id/extend-trial')
  extendTrial(@Param('id') id: string, @Body() dto: ExtendTrialDto) {
    return this.billing.extendTrial(id, dto);
  }

  // ── Invoices ────────────────────────────────────────────────────────────

  @Get('invoices')
  listInvoices(@Query('tenantId') tenantId?: string, @Query('status') status?: string) {
    return this.billing.listInvoices(tenantId, status);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string) {
    return this.billing.findInvoice(id);
  }

  @Post('invoices')
  createInvoice(@Body() dto: CreateInvoiceDto) {
    return this.billing.createInvoice(dto);
  }

  @Post('invoices/:id/issue')
  issueInvoice(@Param('id') id: string) {
    return this.billing.issue(id);
  }

  @Post('invoices/:id/mark-paid')
  markPaid(@Param('id') id: string, @Body() dto: MarkInvoicePaidDto) {
    return this.billing.markPaid(id, dto);
  }

  @Post('invoices/:id/void')
  voidInvoice(@Param('id') id: string) {
    return this.billing.voidInvoice(id);
  }
}
