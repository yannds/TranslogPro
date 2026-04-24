import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, HttpCode, UseGuards,
} from '@nestjs/common';
import { SubscriptionCheckoutService } from './subscription-checkout.service';
import { SubscriptionPaymentMethodsService } from './subscription-payment-methods.service';
import {
  StartSubscriptionCheckoutDto, UpdateAutoRenewDto, CancelSubscriptionDto,
  StartSetupIntentDto,
} from './dto/subscription-checkout.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import {
  RateLimit, RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';

/**
 * Endpoints tenant-admin pour l'abonnement SaaS :
 *
 *   GET   /api/subscription/summary      — statut + jours de trial restants (léger)
 *   GET   /api/subscription/billing      — page /admin/billing (intents + invoices)
 *   POST  /api/subscription/checkout     — initie le paiement, retourne payment URL
 *   PATCH /api/subscription/auto-renew   — toggle prélèvement auto
 *   POST  /api/subscription/cancel       — résilie (prend effet currentPeriodEnd)
 *   POST  /api/subscription/resume       — annule une résiliation planifiée
 *
 * Permission : `SETTINGS_MANAGE_TENANT`. Le tenantId est lu depuis la session
 * — jamais du body. Rate-limit individuel sur les mutations.
 */
@Controller({ version: '1', path: 'subscription' })
@RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
export class SubscriptionCheckoutController {
  constructor(
    private readonly service:        SubscriptionCheckoutService,
    private readonly methodsService: SubscriptionPaymentMethodsService,
  ) {}

  @Get('summary')
  summary(@CurrentUser() user: CurrentUserPayload) {
    return this.service.getBillingSummary(user.tenantId);
  }

  @Get('billing')
  billing(@CurrentUser() user: CurrentUserPayload) {
    return this.service.getBillingDetails(user.tenantId);
  }

  @Post('checkout')
  @HttpCode(201)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'sub_checkout' })
  startCheckout(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: StartSubscriptionCheckoutDto,
  ) {
    return this.service.startCheckout(user.tenantId, dto);
  }

  /**
   * Enregistre un moyen de paiement sans facturation (microcharge + refund auto).
   * Cible les tenants en ACTIVE qui veulent ajouter/remplacer leur carte entre
   * deux renouvellements. Rate-limit plus strict que le checkout (5/h IP) car
   * le flux est volontairement rare et le coût provider non nul (2 × fees).
   */
  @Post('setup-intent')
  @HttpCode(201)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'sub_setup' })
  startSetupIntent(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: StartSetupIntentDto,
  ) {
    return this.service.startSetupIntent(user.tenantId, dto);
  }

  @Patch('auto-renew')
  @HttpCode(200)
  updateAutoRenew(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateAutoRenewDto,
  ) {
    return this.service.updateAutoRenew(user.tenantId, dto);
  }

  @Post('cancel')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'sub_cancel' })
  cancel(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.service.cancel(user.tenantId, dto);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@CurrentUser() user: CurrentUserPayload) {
    return this.service.resume(user.tenantId);
  }

  // ── Moyens de paiement enregistrés ──────────────────────────────────────────

  @Get('payment-methods')
  listPaymentMethods(@CurrentUser() user: CurrentUserPayload) {
    return this.methodsService.list(user.tenantId);
  }

  @Delete('payment-methods/:id')
  @HttpCode(204)
  async removePaymentMethod(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.methodsService.remove(user.tenantId, id);
  }

  @Put('payment-methods/:id/default')
  @HttpCode(200)
  async setDefaultPaymentMethod(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.methodsService.setDefault(user.tenantId, id);
    return { ok: true };
  }
}
