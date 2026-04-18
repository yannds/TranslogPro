import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SecretModule } from '../secret/secret.module';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentRouter } from './payment-router.service';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { PayloadEncryptor } from './payload-encryptor.service';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { PAYMENT_PROVIDERS } from './providers/types';
import { FlutterwaveAggregatorProvider } from './providers/flutterwave-agg.provider';
import { PaystackAggregatorProvider } from './providers/paystack-agg.provider';
import { MtnMomoCgProvider } from './providers/mtn-momo-cg.provider';
import { AirtelMoneyCgProvider } from './providers/airtel-cg.provider';
import { WaveProvider } from './providers/wave.provider';

/**
 * PaymentModule — hub d'accès aux providers de paiement.
 *
 * Expose :
 *   - PaymentProviderRegistry : inventaire runtime des connecteurs + état DB.
 *   - PaymentRouter           : résolution {tenant, country, method} → provider.
 *   - PaymentOrchestrator     : API métier unique (createIntent/confirm/refund).
 *   - PayloadEncryptor        : AES-256-GCM via clé Vault (requestEnc/responseEnc).
 *   - /webhooks/payments/:providerKey  (controller unifié).
 *
 * Ajouter un connecteur : fichier dans providers/ + ligne dans PAYMENT_PROVIDERS.
 */
@Global()
@Module({
  imports: [DatabaseModule, SecretModule],
  controllers: [PaymentWebhookController],
  providers: [
    FlutterwaveAggregatorProvider,
    PaystackAggregatorProvider,
    MtnMomoCgProvider,
    AirtelMoneyCgProvider,
    WaveProvider,
    {
      provide: PAYMENT_PROVIDERS,
      useFactory: (
        fw:  FlutterwaveAggregatorProvider,
        ps:  PaystackAggregatorProvider,
        mtn: MtnMomoCgProvider,
        air: AirtelMoneyCgProvider,
        wv:  WaveProvider,
      ) => [fw, ps, mtn, air, wv],
      inject: [
        FlutterwaveAggregatorProvider, PaystackAggregatorProvider,
        MtnMomoCgProvider, AirtelMoneyCgProvider, WaveProvider,
      ],
    },
    PayloadEncryptor,
    PaymentProviderRegistry,
    PaymentRouter,
    PaymentOrchestrator,
    PaymentReconciliationService,
  ],
  exports: [
    PaymentProviderRegistry,
    PaymentRouter,
    PaymentOrchestrator,
    PayloadEncryptor,
    PaymentReconciliationService,
  ],
})
export class PaymentModule {}
