import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OAuthModule } from '../oauth/oauth.module';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantTaxService } from './tenant-tax.service';
import { TenantPaymentConfigService } from './tenant-payment-config.service';
import { IntegrationsService } from './integrations.service';

/**
 * TenantSettingsModule — regroupe :
 *   - CRUD taxes tenant (TenantTax)
 *   - GET/PATCH TenantPaymentConfig
 *   - UI Intégrations API (aggr. PaymentProviderRegistry + OAuthProviderRegistry)
 *
 * PaymentModule est @Global → PaymentProviderRegistry injectable sans import.
 */
@Module({
  imports: [DatabaseModule, OAuthModule],
  controllers: [TenantSettingsController],
  providers:   [TenantTaxService, TenantPaymentConfigService, IntegrationsService],
  exports:     [TenantTaxService, TenantPaymentConfigService, IntegrationsService],
})
export class TenantSettingsModule {}
