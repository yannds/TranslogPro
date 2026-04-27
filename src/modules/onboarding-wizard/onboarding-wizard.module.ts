import { Module } from '@nestjs/common';
import { OnboardingWizardController } from './onboarding-wizard.controller';
import { OnboardingWizardService } from './onboarding-wizard.service';
import { StaffModule } from '../staff/staff.module';

/**
 * Wizard d'onboarding post-signup (tenant admin).
 *
 * Expose 7 endpoints sous `/api/onboarding/*` — tous protégés par
 * `SETTINGS_MANAGE_TENANT` et scopés au tenant de la session.
 *
 * Dépendances : PrismaService (via DatabaseModule global) et IEmailService
 * (via NotificationProviderModule global) — pas d'imports explicites.
 * StaffModule importé pour StaffProvisioningService (sync RH/IAM des invités).
 */
@Module({
  imports:     [StaffModule],
  controllers: [OnboardingWizardController],
  providers:   [OnboardingWizardService],
})
export class OnboardingWizardModule {}
