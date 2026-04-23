import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

/**
 * AppConfigModule — @Global, expose AppConfigService à tous les modules.
 *
 * Point unique d'accès aux variables d'environnement business. Les modules
 * métier injectent AppConfigService au lieu de lire `process.env` directement.
 *
 * Voir `app-config.service.ts` pour la liste des getters typés supportés.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports:   [AppConfigService],
})
export class AppConfigModule {}
