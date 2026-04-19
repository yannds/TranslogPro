import { Logger } from '@nestjs/common';
import type { ISecretService } from '../../../infrastructure/secret/interfaces/secret.interface';
import { MS_PER_MINUTE } from '../../../common/constants/time';
import {
  type IOAuthProvider,
  type OAuthProviderMetadata,
  type NormalizedOAuthProfile,
  defaultOAuthVaultPath,
  OAuthError,
} from '../types';

/**
 * BaseOAuthProvider — mutualise le pattern Vault + cache pour les 3 providers
 * (Google, Microsoft, Facebook).
 *
 * Chaque provider concret :
 *   - expose `meta` (clé/nom/scopes)
 *   - implémente `buildAuthorizeUrl` et `exchangeCodeForProfile` en appelant
 *     `this.getCredentials()` pour récupérer ses secrets
 *
 * Cache mémoire 5 minutes — aligné sur le pattern TwilioSmsService. Invalidé
 * uniquement par expiration (pas de hot-reload — un redéploiement ou le TTL
 * suffit à propager une rotation de secret).
 */
const CACHE_TTL_MS = 5 * MS_PER_MINUTE;

export abstract class BaseOAuthProvider<TCredentials extends object>
  implements IOAuthProvider {
  abstract readonly meta: OAuthProviderMetadata;

  protected readonly logger = new Logger(this.constructor.name);
  private credentials: TCredentials | null = null;
  private cachedAt = 0;

  constructor(protected readonly secretService: ISecretService) {}

  /**
   * Chemin Vault par défaut. Les providers peuvent override si nécessaire
   * (cas rare — on garde la convention `platform/auth/<key>`).
   */
  protected get vaultPath(): string {
    return defaultOAuthVaultPath(this.meta.key);
  }

  /**
   * Valide que le payload Vault contient toutes les clés attendues.
   * Chaque provider définit sa liste (ex: ['CLIENT_ID', 'CLIENT_SECRET']).
   */
  protected abstract requiredKeys(): readonly string[];

  /**
   * Charge les credentials depuis Vault avec cache 5 min. Lève OAuthError si
   * le secret est absent ou incomplet. Appelé par les méthodes métier.
   */
  protected async getCredentials(): Promise<TCredentials> {
    const now = Date.now();
    if (this.credentials && (now - this.cachedAt) < CACHE_TTL_MS) {
      return this.credentials;
    }
    let raw: TCredentials;
    try {
      raw = await this.secretService.getSecretObject<TCredentials>(this.vaultPath);
    } catch (err) {
      throw new OAuthError(
        'PROVIDER_ERROR',
        `OAuth provider "${this.meta.key}" non configuré (Vault ${this.vaultPath} inaccessible)`,
        { cause: (err as Error)?.message },
      );
    }
    const required = this.requiredKeys();
    const missing  = required.filter(k => !(raw as Record<string, unknown>)[k]);
    if (missing.length > 0) {
      throw new OAuthError(
        'PROVIDER_ERROR',
        `OAuth provider "${this.meta.key}" non configuré (clés manquantes dans ${this.vaultPath}: ${missing.join(', ')})`,
      );
    }
    this.credentials = raw;
    this.cachedAt    = now;
    return raw;
  }

  /**
   * Contrat `isConfigured()` — tente un chargement, retourne false sur
   * n'importe quelle erreur. Ne propage jamais — utilisé uniquement à des
   * fins d'affichage UI.
   */
  async isConfigured(): Promise<boolean> {
    try {
      await this.getCredentials();
      return true;
    } catch {
      return false;
    }
  }

  abstract buildAuthorizeUrl(params: {
    state: string; redirectUri: string; tenantSlug?: string;
  }): Promise<string>;

  abstract exchangeCodeForProfile(params: {
    code: string; state: string; redirectUri: string;
  }): Promise<NormalizedOAuthProfile>;
}
