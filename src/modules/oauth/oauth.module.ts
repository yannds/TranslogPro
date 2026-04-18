import { Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { OAuthStateService } from './oauth-state.service';
import {
  OAuthProviderRegistry,
  OAUTH_PROVIDERS,
} from './providers/oauth-provider.registry';
import { GoogleOAuthProvider } from './providers/google.provider';
import { MicrosoftOAuthProvider } from './providers/microsoft.provider';
import { FacebookOAuthProvider } from './providers/facebook.provider';
import type { IOAuthProvider } from './types';

/**
 * OAuthModule — module "prêt-à-brancher" pour l'authentification sociale.
 *
 * État : **NON IMPORTÉ** dans AppModule tant que la feature n'est pas
 * validée. Pour activer :
 *
 *   1. Setter les env vars d'au moins un provider :
 *        GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *        MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET [/ MICROSOFT_TENANT]
 *        FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET
 *   2. Setter PUBLIC_APP_URL (requis pour construire les callback URLs)
 *   3. Optionnel : OAUTH_LINKING_STRATEGY = AUTO_LINK_VERIFIED | PROMPT | DENY
 *      (défaut : PROMPT)
 *   4. Importer `OAuthModule` dans AppModule.
 *
 * AJOUTER UN PROVIDER :
 *   - Créer `providers/<name>.provider.ts` qui implémente IOAuthProvider.
 *   - L'ajouter dans la liste `providers` ET dans `OAUTH_PROVIDER_CLASSES`.
 *   - Le registry l'ignorera tant que ses env vars ne sont pas setées.
 *
 * RETIRER UN PROVIDER :
 *   - Unset ses env vars → le registry l'ignore, le bouton disparaît côté UI.
 *   - (Optionnel) Le retirer physiquement des deux listes ci-dessous.
 *
 * Zéro modification du controller, service, registry ou frontend.
 */

/**
 * Liste des classes provider connues. Ajouter/retirer ici quand on
 * veut supporter un nouveau provider (Apple, GitHub, LinkedIn…).
 */
const OAUTH_PROVIDER_CLASSES = [
  GoogleOAuthProvider,
  MicrosoftOAuthProvider,
  FacebookOAuthProvider,
];

@Module({
  controllers: [OAuthController],
  providers: [
    OAuthService,
    OAuthStateService,
    OAuthProviderRegistry,

    // Chaque classe provider est un provider NestJS injectable.
    ...OAUTH_PROVIDER_CLASSES,

    // Le registry reçoit la liste des instances via ce token d'injection.
    // Factory : Nest résout chaque classe et passe le tableau au registry.
    {
      provide:    OAUTH_PROVIDERS,
      inject:     OAUTH_PROVIDER_CLASSES,
      useFactory: (...instances: IOAuthProvider[]) => instances,
    },
  ],
  exports: [OAuthService, OAuthProviderRegistry],
})
export class OAuthModule {}
