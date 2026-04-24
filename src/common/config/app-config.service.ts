import { Injectable, Logger } from '@nestjs/common';

/**
 * AppConfigService — source de vérité typée pour toutes les variables
 * d'environnement business (hors infrastructure pure).
 *
 * SECURITY FIRST : centraliser les accès à `process.env` dans un service
 * injectable permet (a) le typage strict, (b) les defaults safe, (c) un point
 * unique d'audit pour la prod checklist, (d) des mocks triviaux en test.
 *
 * Règle architecture hexagonale (PRD §II.5) : les modules métier n'ont PAS le
 * droit de lire `process.env` directement. Ils injectent AppConfigService et
 * consomment les getters typés.
 *
 * Conventions :
 *   - URLs publiques sans slash final (les concaténations ajoutent le slash)
 *   - Les flags booléens retournent `true` uniquement pour `'true'` (lowercase),
 *     tout le reste = `false` (évite les ambiguïtés `'1'`/`'yes'`/…).
 *   - `NODE_ENV` défaut `'development'` si absent (jamais `undefined` retourné).
 */
@Injectable()
export class AppConfigService {
  private readonly log = new Logger(AppConfigService.name);
  private readonly env: NodeJS.ProcessEnv;

  constructor() {
    this.env = process.env;
    this.validateRequiredKeys();
  }

  // ── Environnement ─────────────────────────────────────────────────────────

  get nodeEnv(): string {
    return this.env.NODE_ENV ?? 'development';
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }
  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }
  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }

  // ── Domaines publics ──────────────────────────────────────────────────────

  /** Base domaine public (sans sous-domaine) — `translogpro.com` en prod, `translog.test` en dev. */
  get publicBaseDomain(): string {
    return this.env.PUBLIC_BASE_DOMAIN ?? this.env.PLATFORM_BASE_DOMAIN ?? 'translog.test';
  }
  /** URL de base du portail admin — `https://admin.<baseDomain>` ou override explicite. */
  get publicAppUrl(): string {
    return (this.env.PUBLIC_APP_URL ?? `https://admin.${this.publicBaseDomain}`).replace(/\/$/, '');
  }
  /** URL portail voyageur — `https://portail.<baseDomain>` ou override. */
  get publicPortalUrl(): string {
    return (this.env.PUBLIC_PORTAL_URL ?? `https://portail.${this.publicBaseDomain}`).replace(/\/$/, '');
  }
  /** URL tracking public (colis, billets) — `https://track.<baseDomain>` ou override. */
  get publicTrackingUrl(): string {
    return (this.env.PUBLIC_TRACKING_URL ?? `https://track.${this.publicBaseDomain}`).replace(/\/$/, '');
  }
  /** Base URL docs d'erreurs (RFC 7807 Problem Details `type`) — override via env. */
  get errorDocsBaseUrl(): string {
    return (this.env.ERROR_DOCS_BASE_URL ?? `https://${this.publicBaseDomain}/errors`).replace(/\/$/, '');
  }

  // ── Contacts publics ──────────────────────────────────────────────────────

  /** Email de support affiché aux utilisateurs finaux (emails, footer, erreurs). */
  get supportEmail(): string {
    return this.env.SUPPORT_EMAIL ?? `support@${this.publicBaseDomain}`;
  }

  // ── Feature flags ─────────────────────────────────────────────────────────

  get activationEmailsEnabled(): boolean {
    return this.env.ACTIVATION_EMAILS_ENABLED === 'true';
  }
  get dunningEmailsEnabled(): boolean {
    return this.env.DUNNING_EMAILS_ENABLED === 'true';
  }
  get renewalRemindersEnabled(): boolean {
    return this.env.RENEWAL_REMINDERS_ENABLED === 'true';
  }

  // ── Provider choix (bootstrap, pas runtime) ───────────────────────────────

  /** Provider email sélectionné — `console` (dev) | `smtp` | `resend` | `microsoft365`. */
  get emailProvider(): string {
    return this.env.EMAIL_PROVIDER ?? (this.isProduction ? 'resend' : 'console');
  }
  /** Stratégie OAuth linking : `strict` (défaut, match email exact) ou `flexible`. */
  get oauthLinkingStrategy(): 'strict' | 'flexible' {
    return this.env.OAUTH_LINKING_STRATEGY === 'flexible' ? 'flexible' : 'strict';
  }

  // ── Sécurité sensible ─────────────────────────────────────────────────────

  /** Clé bootstrap plateforme (super-admin provisioning initial). Jamais loggée. */
  get platformBootstrapKey(): string | undefined {
    return this.env.PLATFORM_BOOTSTRAP_KEY;
  }

  // ── Génériques (escape hatch pour cas non modélisés) ──────────────────────

  /** Lecture brute typée string — à utiliser uniquement si pas de getter dédié. */
  getString(key: string, fallback?: string): string {
    const v = this.env[key];
    if (v !== undefined) return v;
    if (fallback !== undefined) return fallback;
    throw new Error(`AppConfigService: env var "${key}" is required but missing`);
  }

  /** Lecture brute typée booléen — strict `'true'` uniquement. */
  getBoolean(key: string, fallback = false): boolean {
    const v = this.env[key];
    if (v === 'true')  return true;
    if (v === 'false') return false;
    return fallback;
  }

  /** Lecture brute typée entier. */
  getNumber(key: string, fallback?: number): number {
    const v = this.env[key];
    if (v === undefined) {
      if (fallback !== undefined) return fallback;
      throw new Error(`AppConfigService: env var "${key}" is required but missing`);
    }
    const n = Number(v);
    if (Number.isNaN(n)) {
      throw new Error(`AppConfigService: env var "${key}" is not a valid number (got "${v}")`);
    }
    return n;
  }

  // ── Validation au boot ────────────────────────────────────────────────────

  /**
   * Warn console si des variables critiques prod sont absentes. Ne bloque
   * jamais le boot (les modules qui en ont besoin lèveront à leur tour).
   * But : catch les oublis avant qu'un endpoint ne crash.
   */
  private validateRequiredKeys(): void {
    if (!this.isProduction) return; // dev/test tolérant

    const prodRequired = [
      'PUBLIC_BASE_DOMAIN',
      'PUBLIC_APP_URL',
    ];
    for (const key of prodRequired) {
      if (!this.env[key]) {
        this.log.warn(`[AppConfig] Variable "${key}" absente en production — risque de dysfonctionnement.`);
      }
    }
  }
}
