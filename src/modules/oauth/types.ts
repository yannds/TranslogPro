/**
 * Types partagés du module OAuth — contrat public.
 *
 * Objectif : décorréler le cœur OAuth (registry, service, controller) des
 * providers concrets. Ajouter/retirer/remplacer un provider doit se faire
 * en implémentant IOAuthProvider, sans toucher aux consommateurs.
 */

/** Clé stable d'un provider. Doit matcher `Account.providerId` en DB. */
export type OAuthProviderKey = string;

/**
 * Profil utilisateur après exchange (code → tokens → userinfo).
 * Toute la logique d'authentification downstream ne dépend QUE de cette
 * forme normalisée. Les champs raw/tokens sont conservés pour audit et
 * pour permettre aux providers spécifiques d'ajouter des données.
 */
export interface NormalizedOAuthProfile {
  providerKey:        OAuthProviderKey;
  /** ID unique chez le provider (sub OIDC, id Facebook, oid Azure…). */
  providerAccountId:  string;
  email:              string | null;
  /** True si le provider garantit que l'email a été vérifié. Critique pour le linking. */
  emailVerified:      boolean;
  name:               string | null;
  avatarUrl:          string | null;
  locale:             string | null;
  /** Access token (peut être stocké si refresh token absent et access long). */
  accessToken?:       string;
  /** Refresh token si scope/flow le permet. */
  refreshToken?:      string;
  /** Expiration access_token (epoch ms). */
  accessTokenExpires?: Date;
  /** Payload brut utile pour audit et debug (ne jamais exposer en API). */
  raw:                Record<string, unknown>;
}

/**
 * Métadonnées exposées au frontend (`GET /auth/oauth/providers`).
 * Ne PAS exposer de secret ici.
 */
export interface OAuthProviderMetadata {
  key:          OAuthProviderKey;
  displayName:  string;
  /** Icône à afficher sur le bouton (URL ou nom d'icône côté client). */
  icon?:        string;
  /** Scopes demandés — information transparente, non-critique. */
  scopes:       string[];
}

/**
 * Stratégie de linking quand un OAuth profile arrive avec un email
 * qui matche déjà un User existant via un autre provider (credential,
 * autre OAuth, etc.).
 *
 * - AUTO_LINK_VERIFIED : lie automatiquement si emailVerified === true.
 *                         Pratique mais risque modéré : faire confiance au
 *                         provider pour ne pas relier à un compte homonyme.
 * - PROMPT             : redirige vers une page "Voulez-vous lier X à Y ?"
 *                         (recommandé, zéro auto-link silencieux).
 * - DENY               : refuse et affiche "ce compte existe déjà, utilisez
 *                         votre méthode de connexion précédente".
 */
export type LinkingStrategy = 'AUTO_LINK_VERIFIED' | 'PROMPT' | 'DENY';

/** Chemin Vault par défaut pour un provider OAuth donné. */
export function defaultOAuthVaultPath(providerKey: OAuthProviderKey): string {
  return `platform/auth/${providerKey}`;
}

/**
 * Interface que tout provider DOIT implémenter.
 *
 * Pour ajouter un nouveau provider : créer une classe @Injectable, exposer
 * `meta`, `isConfigured()`, `buildAuthorizeUrl`, `exchangeCodeForProfile`,
 * puis la déclarer dans OAuthModule.providers + OAUTH_PROVIDERS array.
 *
 * Le registry référence TOUS les providers déclarés — même non configurés —
 * pour que l'UI puisse les afficher grisés. Le filtrage effectif se fait à
 * l'appel (buildAuthorizeUrl/exchange) : si les credentials manquent, le
 * provider lève OAuthError('PROVIDER_ERROR').
 */
export interface IOAuthProvider {
  readonly meta: OAuthProviderMetadata;

  /**
   * True si les credentials du provider sont présents dans Vault.
   * Résultat mis en cache 5 minutes côté provider pour éviter un appel
   * Vault à chaque navigation UI. Retourne false sur n'importe quelle
   * erreur Vault (secret absent, réseau, permissions) — la liste UI
   * reste disponible, le provider est juste affiché grisé.
   */
  isConfigured(): Promise<boolean>;

  /**
   * Construit l'URL d'autorisation (redirection navigateur étape 1).
   * `state` est un nonce signé émis par OAuthStateService ; il DOIT être
   * transmis tel quel et vérifié au callback.
   *
   * Lève OAuthError('PROVIDER_ERROR') si les credentials Vault sont absents.
   */
  buildAuthorizeUrl(params: {
    state:        string;
    redirectUri:  string;
    /** Slug tenant optionnel — encodé via state, pas via URL directe. */
    tenantSlug?:  string;
  }): Promise<string>;

  /**
   * Étape 2 : échange code → access_token → userinfo → profil normalisé.
   * Le caller vérifie déjà le state avant d'appeler cette méthode.
   */
  exchangeCodeForProfile(params: {
    code:         string;
    state:        string;
    redirectUri:  string;
  }): Promise<NormalizedOAuthProfile>;
}

/**
 * Payload du state (nonce CSRF). Stocké en Redis (ou signé HMAC) avec TTL
 * court (10 min). Transmis tel quel à l'authorize URL, vérifié au callback.
 */
export interface OAuthStatePayload {
  providerKey:  OAuthProviderKey;
  nonce:        string;
  tenantSlug?:  string;
  /** URL de redirection finale post-auth (optionnelle). */
  returnTo?:    string;
  issuedAt:     number; // epoch ms
}

/** Résultat de l'authentification OAuth (succès). */
export interface OAuthAuthenticationResult {
  sessionToken: string;
  userId:       string;
  tenantId:     string;
  /** True si un nouveau Account OAuth a été créé (premier login). */
  isNewLink:    boolean;
}

/** Erreurs métier (pas réseau) remontées à l'UI. */
export type OAuthAuthenticationError =
  | 'UNKNOWN_PROVIDER'
  | 'INVALID_STATE'
  | 'EMAIL_UNVERIFIED'
  | 'NO_EMAIL'
  | 'USER_NOT_FOUND'          // strict : pas d'auto-création
  | 'LINKING_REQUIRED'         // PROMPT strategy — renvoyer vers page confirm
  | 'LINKING_DENIED'           // DENY strategy
  | 'PROVIDER_ERROR';

export class OAuthError extends Error {
  constructor(
    public readonly code: OAuthAuthenticationError,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}
