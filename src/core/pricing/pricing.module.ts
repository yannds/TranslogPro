import { Module } from '@nestjs/common';
import { PricingEngine } from './pricing.engine';
import { TenantSettingsModule } from '../../modules/tenant-settings/tenant-settings.module';

// PricingEngine dépend de TenantFareClassService (résolution multiplier classe)
// et lit directement `tenantTax` via Prisma. TenantSettingsModule exporte le
// service de classes ; PlatformConfigModule est global.
@Module({
  imports:   [TenantSettingsModule],
  providers: [PricingEngine],
  exports:   [PricingEngine],
})
export class PricingModule {}
