import { Module } from '@nestjs/common';
import { SubscriptionCheckoutController } from './subscription-checkout.controller';
import { SubscriptionCheckoutService } from './subscription-checkout.service';
import { SubscriptionReconciliationService } from './subscription-reconciliation.service';
import { SubscriptionRenewalService } from './subscription-renewal.service';
import { SubscriptionDunningService } from './subscription-dunning.service';

/**
 * Cycle complet d'abonnement SaaS :
 *
 *   - `SubscriptionCheckoutService`       → crée les Intents + toggle auto-renew
 *                                           + cancel/resume self-service
 *   - `SubscriptionReconciliationService` → écoute PAYMENT_INTENT_SUCCEEDED
 *                                           et passe la sub en ACTIVE, capture
 *                                           les refs pour auto-renew futur
 *   - `SubscriptionRenewalService`        → cron J-3, tente auto-charge si
 *                                           autoRenew=true, sinon rappel email
 *   - `SubscriptionDunningService`        → écoute PAYMENT_INTENT_FAILED + cron
 *                                           quotidien (J+1/J+3/J+7), escalade
 *                                           SUSPENDED après 10j en PAST_DUE
 *
 * PaymentOrchestrator + PrismaService + IEmailService sont tous fournis
 * globalement par les modules infra.
 */
@Module({
  controllers: [SubscriptionCheckoutController],
  providers:   [
    SubscriptionCheckoutService,
    SubscriptionReconciliationService,
    SubscriptionRenewalService,
    SubscriptionDunningService,
  ],
})
export class SubscriptionCheckoutModule {}
