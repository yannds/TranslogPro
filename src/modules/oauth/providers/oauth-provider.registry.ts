import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import type { IOAuthProvider, OAuthProviderMetadata } from '../types';

/**
 * Token DI pour injecter la liste des providers concrets. Déclaré
 * comme `provide: OAUTH_PROVIDERS, useValue: [...]` dans OAuthModule.
 * Cette indirection permet d'ajouter/retirer des providers en ne touchant
 * qu'UN endroit (la liste du module), sans modifier le registry.
 */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');

/**
 * Registry des providers OAuth effectivement actifs.
 *
 * Règle unique : un provider est retenu si et seulement si `isEnabled` est
 * true au démarrage (typiquement : ses env vars sont setées). Sinon il est
 * ignoré silencieusement. Aucune erreur ne remonte — un admin qui oublie
 * une variable voit juste le bouton disparaître.
 *
 * Le registry NE FAIT AUCUNE hypothèse sur le provider concret : il traite
 * Google, Microsoft, Facebook, Apple, GitHub ou tout futur ajout de la
 * même manière via l'interface IOAuthProvider.
 */
@Injectable()
export class OAuthProviderRegistry implements OnModuleInit {
  private readonly log = new Logger(OAuthProviderRegistry.name);
  private readonly active = new Map<string, IOAuthProvider>();

  constructor(
    @Inject(OAUTH_PROVIDERS) private readonly all: IOAuthProvider[],
  ) {}

  onModuleInit(): void {
    for (const provider of this.all) {
      if (!provider.isEnabled) {
        this.log.debug(`[OAuth] provider "${provider.meta.key}" disabled (missing env) — skipped`);
        continue;
      }
      if (this.active.has(provider.meta.key)) {
        this.log.warn(`[OAuth] duplicate provider key "${provider.meta.key}" — keeping first`);
        continue;
      }
      this.active.set(provider.meta.key, provider);
      this.log.log(`[OAuth] provider "${provider.meta.key}" registered`);
    }
  }

  /** Retourne le provider actif pour une clé, ou undefined. */
  get(key: string): IOAuthProvider | undefined {
    return this.active.get(key);
  }

  /** Liste des métadonnées publiques — consommée par `GET /auth/oauth/providers`. */
  list(): OAuthProviderMetadata[] {
    return Array.from(this.active.values()).map(p => p.meta);
  }

  /** Nombre de providers actifs — utile pour tests/monitoring. */
  count(): number {
    return this.active.size;
  }
}
