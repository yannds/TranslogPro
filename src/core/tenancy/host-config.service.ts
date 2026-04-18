/**
 * HostConfigService — Configuration centralisée des domaines plateforme.
 *
 * Source unique pour :
 *   - Domaine de base (ex: "translogpro.com" en prod, "translog.test" en dev)
 *   - Sous-domaine admin plateforme (ex: "admin" → admin.translogpro.com)
 *   - Liste des sous-domaines réservés (jamais routés comme tenant)
 *   - Helpers de construction d'URL tenant-scoped et admin-scoped
 *
 * DESIGN : chaque valeur est lue depuis `process.env` avec un défaut sûr.
 * Le même binaire tourne donc en dev (translog.test) et en prod (translogpro.com)
 * sans recompilation — seule la variable d'environnement change.
 *
 * Phase 3 (custom domains) : HostConfig reste inchangé. Les custom domains
 * sont résolus par TenantResolverService via la table TenantDomain, qui
 * s'ajoute par-dessus cette config.
 */

import { Injectable, Logger } from '@nestjs/common';

const RESERVED_SUBDOMAINS_DEFAULT = Object.freeze([
  'admin', 'api', 'www', 'mail', 'static', 'assets', 'cdn',
  'ftp', 'webmail', 'mx', 'ns', 'smtp', 'imap', 'pop',
  'help', 'support', 'status', 'docs',
]);

export interface IHostConfig {
  readonly platformBaseDomain: string;
  readonly adminSubdomain:     string;
  readonly reservedSubdomains: readonly string[];
  readonly protocol:           'http' | 'https';

  isReservedSubdomain(subdomain: string): boolean;
  extractSubdomain(hostname: string): string | null;
  buildTenantUrl(slug: string, path?: string): string;
  buildAdminUrl(path?: string): string;
  isPlatformHost(hostname: string): boolean;
  isAdminHost(hostname: string): boolean;
}

@Injectable()
export class HostConfigService implements IHostConfig {
  private readonly logger = new Logger(HostConfigService.name);

  readonly platformBaseDomain: string;
  readonly adminSubdomain:     string;
  readonly reservedSubdomains: readonly string[];
  readonly protocol:           'http' | 'https';

  constructor() {
    this.platformBaseDomain = (process.env.PLATFORM_BASE_DOMAIN ?? 'translog.test').toLowerCase();
    this.adminSubdomain     = (process.env.ADMIN_SUBDOMAIN     ?? 'admin').toLowerCase();

    const extra = (process.env.RESERVED_SUBDOMAINS ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    this.reservedSubdomains = Object.freeze([...new Set([
      ...RESERVED_SUBDOMAINS_DEFAULT,
      this.adminSubdomain,
      ...extra,
    ])]);

    // En prod HTTPS exclusivement. En dev HTTPS aussi (mkcert + Caddy).
    // http:// n'est supporté nulle part par design — simplifie les tests.
    this.protocol = 'https';

    this.logger.log(
      `[HostConfig] baseDomain=${this.platformBaseDomain} ` +
      `adminSubdomain=${this.adminSubdomain} ` +
      `protocol=${this.protocol} ` +
      `reservedCount=${this.reservedSubdomains.length}`,
    );
  }

  // ─── Helpers publics ──────────────────────────────────────────────────────

  isReservedSubdomain(subdomain: string): boolean {
    return this.reservedSubdomains.includes(subdomain.toLowerCase());
  }

  /**
   * Extrait le sous-domaine plateforme depuis un hostname entrant.
   *
   * Exemples (avec platformBaseDomain = 'translogpro.com') :
   *   - 'tenanta.translogpro.com'       → 'tenanta'
   *   - 'tenanta.translogpro.com:8080'  → 'tenanta'  (port strippé)
   *   - 'admin.translogpro.com'         → 'admin'
   *   - 'translogpro.com'               → null       (pas de sous-domaine)
   *   - 'evil.com'                      → null       (hors plateforme)
   *   - 'deep.sub.translogpro.com'      → 'deep.sub' (sous-domaines imbriqués autorisés)
   *
   * Retourne null si le hostname ne finit pas par .{platformBaseDomain}.
   */
  extractSubdomain(hostname: string): string | null {
    if (!hostname) return null;

    // Strip port et lowercase
    const host   = hostname.split(':')[0]!.toLowerCase().trim();
    const suffix = `.${this.platformBaseDomain}`;

    if (host === this.platformBaseDomain) return null;   // apex domain, pas de sous-domaine
    if (!host.endsWith(suffix))            return null;   // host hors plateforme

    const sub = host.slice(0, -suffix.length);
    return sub || null;
  }

  /**
   * Construit l'URL canonique d'un tenant : `{protocol}://{slug}.{baseDomain}{path}`
   * Utilisé par les emails (reset password), les redirects, les liens cross-tenant.
   */
  buildTenantUrl(slug: string, path = '/'): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.protocol}://${slug.toLowerCase()}.${this.platformBaseDomain}${normalized}`;
  }

  /**
   * Construit l'URL admin plateforme (super-admin zone, Phase 2).
   */
  buildAdminUrl(path = '/'): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${this.protocol}://${this.adminSubdomain}.${this.platformBaseDomain}${normalized}`;
  }

  /**
   * Vrai si le hostname appartient au domaine plateforme (subdomain ou apex).
   * Les custom domains (Phase 3) retournent false ici — c'est attendu.
   */
  isPlatformHost(hostname: string): boolean {
    const host = hostname.split(':')[0]!.toLowerCase();
    return host === this.platformBaseDomain || host.endsWith(`.${this.platformBaseDomain}`);
  }

  /**
   * Vrai si le hostname est exactement le sous-domaine admin plateforme.
   */
  isAdminHost(hostname: string): boolean {
    return this.extractSubdomain(hostname) === this.adminSubdomain;
  }
}
