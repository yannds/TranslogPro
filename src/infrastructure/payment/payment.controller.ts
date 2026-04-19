import {
  Controller, Post, Get, Body, Param, NotFoundException, ForbiddenException, UseGuards,
} from '@nestjs/common';
import { PaymentOrchestrator, CreateIntentDto } from './payment-orchestrator.service';
import { PrismaService } from '../database/prisma.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

/**
 * Endpoints paiement exposés aux apps (web + mobile).
 *
 * Sécurité :
 *   - Toutes les routes sont scope tenant (tenantId dans le path + match par guard).
 *   - getIntent / cancel vérifient que l'intent appartient bien au tenant de la
 *     session — sinon NotFound (pas de leak cross-tenant).
 *   - createIntent est rate-limité par userId pour éviter le spam d'intents.
 */
@Controller('tenants/:tenantId/payments')
export class PaymentController {
  constructor(
    private readonly orchestrator: PaymentOrchestrator,
    private readonly prisma:       PrismaService,
  ) {}

  /**
   * Créer un PaymentIntent. Le caller fournit idempotencyKey + entityType +
   * subtotal (HT — taxes calculées côté server).
   * Retourne l'intentId + paymentUrl (cas hosted) ou status direct (cash).
   */
  @Post('intents')
  @RequirePermission(Permission.CASHIER_TRANSACTION_OWN)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    60,
    windowMs: 60_000,
    keyBy:    'userId',
    suffix:   'payment_intent_create',
    message:  'Trop de tentatives de paiement — réessayez dans 1 minute.',
  })
  createIntent(
    @TenantId() tenantId: string,
    @Body() dto: CreateIntentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    // Forcer customerId à null si non fourni — évite qu'un actor tente
    // d'imputer un paiement à un client arbitraire via le body (on
    // pourra l'associer ultérieurement par le flux CRM si nécessaire).
    return this.orchestrator.createIntent(tenantId, dto);
  }

  /**
   * Lire un Intent — TENANT ISOLATION : on vérifie en DB que l'Intent
   * appartient bien au tenant du caller. Sinon NotFound (pas de leak).
   */
  @Get('intents/:intentId')
  @RequirePermission(Permission.CASHIER_OPEN_OWN)
  async getIntent(
    @TenantId() tenantId: string,
    @Param('intentId') intentId: string,
  ) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id: intentId, tenantId },
      include: { attempts: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} not found`);
    // Ne JAMAIS retourner les payloads chiffrés requestEnc/responseEnc → strip.
    return {
      id:             intent.id,
      tenantId:       intent.tenantId,
      status:         intent.status,
      amount:         intent.amount,
      currency:       intent.currency,
      method:         intent.method,
      entityType:     intent.entityType,
      entityId:       intent.entityId,
      subtotal:       intent.subtotal,
      taxBreakdown:   intent.taxBreakdown,
      expiresAt:      intent.expiresAt,
      settledAt:      intent.settledAt,
      createdAt:      intent.createdAt,
      attempts:       intent.attempts.map(a => ({
        id:           a.id,
        providerKey:  a.providerKey,
        status:       a.status,
        amount:       a.amount,
        currency:     a.currency,
        paymentUrl:   a.paymentUrl,
        externalRef:  a.externalRef,
        failureCode:  a.failureCode,
        failureMessage: a.failureMessage,
        createdAt:    a.createdAt,
      })),
    };
  }

  /**
   * Annuler un Intent (uniquement si pas encore SUCCEEDED).
   * Vérifie tenant avant délégation.
   */
  @Post('intents/:intentId/cancel')
  @RequirePermission(Permission.CASHIER_TRANSACTION_OWN)
  async cancel(
    @TenantId() tenantId: string,
    @Param('intentId') intentId: string,
    @Body('reason') reason: string,
  ) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where:  { id: intentId, tenantId },
      select: { id: true },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} not found`);
    return this.orchestrator.cancel(intentId, reason ?? 'manual');
  }

  /**
   * Rembourser un Intent — permission dédiée REFUND_APPROVE_TENANT.
   */
  @Post('intents/:intentId/refund')
  @RequirePermission(Permission.REFUND_APPROVE_TENANT)
  async refund(
    @TenantId() tenantId: string,
    @Param('intentId') intentId: string,
    @Body() dto: { amount?: number; reason: string },
  ) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where:  { id: intentId, tenantId },
      select: { id: true },
    });
    if (!intent) throw new NotFoundException(`Intent ${intentId} not found`);
    return this.orchestrator.refund(intentId, dto);
  }
}
