import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PlatformBillingModule } from '../platform-billing/platform-billing.module';
import { PlatformPlansModule } from '../platform-plans/platform-plans.module';
import { AuthModule } from '../auth/auth.module';
import { PublicSignupController } from './public-signup.controller';
import { PublicSignupService } from './public-signup.service';

/**
 * Module publiant les 3 endpoints publics d'onboarding SaaS :
 *   POST /public/waitlist  — capture early-access
 *   GET  /public/plans     — catalogue public
 *   POST /public/signup    — création tenant (transaction atomique)
 *
 * Réutilise les services existants (pas de duplication) :
 *   - OnboardingService       (création tenant atomique)
 *   - PlatformBillingService  (souscription TRIAL)
 *   - PlatformPlansService    (catalogue)
 *   - AuthService             (credential account)
 */
@Module({
  imports: [
    OnboardingModule,
    PlatformBillingModule,
    PlatformPlansModule,
    AuthModule,
  ],
  controllers: [PublicSignupController],
  providers:   [PublicSignupService],
})
export class PublicSignupModule {}
