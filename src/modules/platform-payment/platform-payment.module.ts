import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { SecretModule } from '../../infrastructure/secret/secret.module';
import { PaymentModule } from '../../infrastructure/payment/payment.module';
import { PlatformPaymentService } from './platform-payment.service';
import { PlatformPaymentController } from './platform-payment.controller';
import { PlatformFeePublicController } from './platform-fee-public.controller';
import { PlatformIntegrationsService } from './platform-integrations.service';
import { PlatformIntegrationsController } from './platform-integrations.controller';

@Module({
  imports:     [DatabaseModule, SecretModule, PaymentModule],
  providers:   [PlatformPaymentService, PlatformIntegrationsService],
  controllers: [
    PlatformPaymentController,
    PlatformFeePublicController,
    PlatformIntegrationsController,
  ],
  exports:     [PlatformPaymentService, PlatformIntegrationsService],
})
export class PlatformPaymentModule {}
