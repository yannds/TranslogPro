/**
 * frontend/lib/tenancy/host.ts — Résolution tenant côté navigateur.
 *
 * MIROIR de `src/core/tenancy/host-config.service.ts` côté backend.
 * Principe : le sous-domaine de `window.location.host` est le slug du tenant.
 *
 * Phase 1 :
 *   - `abc.translogpro.com` (prod)  → slug = "abc"
 *   - `abc.translog.test`   (dev)   → slug = "abc"
 *   - `admin.translogpro.com`       → isAdmin = true
 *   - `translogpro.com`             → null (apex, pas de tenant)
 *
 * Phase 3 (custom domains) : si window.location.host ne finit pas par
 * `.translogpro.com`, on demande au backend via GET /api/tenants/resolve-host
 * (non implémenté en Phase 1 — retourne null).
 *
 * Pour le routing legacy `/p/:tenantSlug/*`, voir legacy-path.ts.
 */

// ─── Config — mirroir de HostConfigService backend ────────────────────────

const RESERVED_SUBDOMAINS = new Set([
  'admin', 'api', 'www', 'mail', 'static', 'assets', 'cdn',
  'ftp', 'webmail', 'mx', 'ns', 'smtp', 'imap', 'pop',
  'help', 'support', 'status', 'docs',
]);

/**
 * Le domaine de base est injecté au build par Vite via import.meta.env.VITE_PLATFORM_BASE_DOMAIN.
 * Défaut: translog.test (dev). En prod, build avec VITE_PLATFORM_BASE_DOMAIN=translogpro.com.
 *
 * En secours si l'env n'est pas set, on essaie d'inférer depuis le host courant
 * (strip le dernier label + TLD). Ce fallback fait AU MIEUX et doit être évité
 * — préférer toujours build-time.
 */
function resolvePlatformBaseDomain(): string {
  // IMPORTANT : accès DIRECT à import.meta.env.VITE_* — tout cast (as any)
  // ou optional chaining empêche Vite de faire le static replacement au build.
  // Le typage vient de frontend/vite-env.d.ts.
  const viteEnv = import.meta.env.VITE_PLATFORM_BASE_DOMAIN;
  if (typeof viteEnv === 'string' && viteEnv.length > 0) {
    return viteEnv.toLowerCase();
  }
  // Fallback : essayer d'extraire depuis le host courant. Non-fiable si multi-level TLD.
  if (typeof window !== 'undefined' && window.location?.host) {
    const parts = window.location.host.split(':')[0]!.split('.');
    if (parts.length >= 2) return parts.slice(-2).join('.').toLowerCase();
  }
  return 'translog.test';
}

export const PLATFORM_BASE_DOMAIN = resolvePlatformBaseDomain();
export const ADMIN_SUBDOMAIN      = 'admin';

// ─── API publique ────────────────────────────────────────────────────────────

export interface ResolvedHost {
  /** Slug tenant extrait ou null si apex / non plateforme */
  slug:       string | null;
  /** Vrai ssi host == `{adminSubdomain}.{baseDomain}` */
  isAdmin:    boolean;
  /** Vrai ssi host appartient au domaine plateforme (endsWith baseDomain) */
  isPlatform: boolean;
  /** Hostname courant normalisé (lowercase, sans port) */
  hostname:   string;
}

/**
 * Parse un hostname (ou window.location.host par défaut) et retourne sa
 * résolution tenant.
 */
export function resolveHost(host?: string): ResolvedHost {
  const raw = (host ?? (typeof window !== 'undefined' ? window.location.host : '') ?? '');
  const hostname = raw.split(':')[0]!.toLowerCase().trim();

  if (!hostname) {
    return { slug: null, isAdmin: false, isPlatform: false, hostname: '' };
  }

  const suffix = `.${PLATFORM_BASE_DOMAIN}`;
  const isPlatform = hostname === PLATFORM_BASE_DOMAIN || hostname.endsWith(suffix);

  if (!isPlatform) {
    // Phase 3 : custom domain — résolvable uniquement côté backend via
    // TenantDomain. Ici on ne peut rien inférer → null.
    return { slug: null, isAdmin: false, isPlatform: false, hostname };
  }

  if (hostname === PLATFORM_BASE_DOMAIN) {
    // Apex — pas de tenant
    return { slug: null, isAdmin: false, isPlatform: true, hostname };
  }

  const sub = hostname.slice(0, -suffix.length);

  if (sub === ADMIN_SUBDOMAIN) {
    return { slug: null, isAdmin: true, isPlatform: true, hostname };
  }

  if (RESERVED_SUBDOMAINS.has(sub)) {
    // api, www, mail, etc. — pas de tenant non plus
    return { slug: null, isAdmin: false, isPlatform: true, hostname };
  }

  return { slug: sub, isAdmin: false, isPlatform: true, hostname };
}

/**
 * Construit une URL vers un autre tenant (redirect transitoire, liens cross-tenant).
 */
export function buildTenantUrl(slug: string, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const proto = typeof window !== 'undefined' && window.location?.protocol
    ? window.location.protocol
    : 'https:';
  const port = typeof window !== 'undefined' && window.location?.port
    ? `:${window.location.port}`
    : '';
  return `${proto}//${slug.toLowerCase()}.${PLATFORM_BASE_DOMAIN}${port}${normalized}`;
}

export function buildAdminUrl(path = '/'): string {
  return buildTenantUrl(ADMIN_SUBDOMAIN, path);
}
