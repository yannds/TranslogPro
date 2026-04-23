import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

/**
 * OnboardingModule — provisioning tenant atomique (signup public, seed).
 *
 * NE PAS CONFONDRE avec `OnboardingWizardModule` :
 *   - `OnboardingModule`       = service bas niveau, consommé par PublicSignupService
 *                                pour créer un tenant + agence + admin + IAM en une
 *                                transaction (appelé à la soumission du signup form).
 *   - `OnboardingWizardModule` = contrôleur HTTP + service pour guider l'admin
 *                                tenant à travers les 6 étapes post-signup
 *                                (brand, agence, station, route, invitations).
 *
 * Ne pas importer directement dans AppModule — il est déjà importé par
 * PublicSignupModule qui en a besoin.
 */
@Module({
  providers: [OnboardingService],
  exports:   [OnboardingService],
})
export class OnboardingModule {}
