import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { OAuthModule } from '../oauth/oauth.module';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantTaxService } from './tenant-tax.service';
import { TenantFareClassService } from './tenant-fare-class.service';
import { TenantPaymentConfigService } from './tenant-payment-config.service';
import { IntegrationsService } from './integrations.service';
import { TenantResetService } from './tenant-reset.service';

/**
 * TenantSettingsModule — regroupe :
 *   - CRUD taxes tenant (TenantTax)
 *   - CRUD classes de voyage (TenantFareClass)
 *   - GET/PATCH TenantPaymentConfig
 *   - UI Intégrations API (aggr. PaymentProviderRegistry + OAuthProviderRegistry)
 *
 * PaymentModule + PlatformConfigModule sont @Global → injectables sans import.
 */
@Module({
  imports: [DatabaseModule, OAuthModule],
  controllers: [TenantSettingsController],
  providers:   [TenantTaxService, TenantFareClassService, TenantPaymentConfigService, IntegrationsService, TenantResetService],
  exports:     [TenantTaxService, TenantFareClassService, TenantPaymentConfigService, IntegrationsService, TenantResetService],
})
export class TenantSettingsModule {}
