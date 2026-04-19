import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IOAuthProvider, OAuthProviderMetadata } from '../types';

/**
 * Token DI pour injecter la liste des providers concrets. Déclaré
 * comme `provide: OAUTH_PROVIDERS, useValue: [...]` dans OAuthModule.
 * Cette indirection permet d'ajouter/retirer des providers en ne touchant
 * qu'UN endroit (la liste du module), sans modifier le registry.
 */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');

/**
 * Registry des providers OAuth déclarés.
 *
 * **Nouveauté (migration Vault)** — le registre référence TOUS les providers
 * déclarés, même ceux dont les credentials Vault sont absents. Le filtrage
 * "configuré / non configuré" est fait à l'appel via `isConfigured()` :
 *
 *   - `list()` / `listWithStatus()` retourne tous les providers pour l'UI
 *     (qui les affiche grisés si non configurés)
 *   - `get(key)` retourne le provider même si non configuré ; c'est
 *     `buildAuthorizeUrl()` / `exchangeCodeForProfile()` qui lèvent
 *     `OAuthError('PROVIDER_ERROR')` tant que Vault n'a pas les secrets.
 *
 * Le registry NE FAIT AUCUNE hypothèse sur le provider concret : il traite
 * Google, Microsoft, Facebook, Apple, GitHub ou tout futur ajout de la
 * même manière via l'interface IOAuthProvider.
 */
@Injectable()
export class OAuthProviderRegistry {
  private readonly log = new Logger(OAuthProviderRegistry.name);
  private readonly providers = new Map<string, IOAuthProvider>();

  constructor(
    @Inject(OAUTH_PROVIDERS) private readonly all: IOAuthProvider[],
  ) {
    // Indexation par key au boot — un seul provider par clé (first wins).
    for (const p of all) {
      if (this.providers.has(p.meta.key)) {
        this.log.warn(`[OAuth] duplicate provider key "${p.meta.key}" — keeping first`);
        continue;
      }
      this.providers.set(p.meta.key, p);
    }
    this.log.log(`[OAuth] ${this.providers.size} provider(s) declared : ${Array.from(this.providers.keys()).join(', ')}`);
  }

  /** Retourne le provider pour une clé, ou undefined si non déclaré. */
  get(key: string): IOAuthProvider | undefined {
    return this.providers.get(key);
  }

  /**
   * Liste des métadonnées publiques de tous les providers déclarés.
   * Consommée par `GET /auth/oauth/providers`.
   */
  list(): OAuthProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => p.meta);
  }

  /**
   * Liste enrichie avec statut de configuration (appelle `isConfigured()`
   * sur chaque provider). Consommée par la page Intégrations pour afficher
   * les providers grisés quand Vault n'a pas leurs secrets.
   */
  async listWithStatus(): Promise<Array<{
    meta: OAuthProviderMetadata;
    configured: boolean;
  }>> {
    return Promise.all(
      Array.from(this.providers.values()).map(async p => ({
        meta:       p.meta,
        configured: await p.isConfigured(),
      })),
    );
  }

  /** Nombre de providers déclarés — utile pour tests/monitoring. */
  count(): number {
    return this.providers.size;
  }
}
