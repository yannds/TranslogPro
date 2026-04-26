/**
 * Portail cible selon les permissions de l'utilisateur.
 * Aligné sur `frontend/lib/navigation/resolvePortal.ts`.
 *
 * ORDRE CRITIQUE : platform > admin > driver > station > quai > cashier > customer.
 * Les rôles admin (TENANT_ADMIN, SUPER_ADMIN) héritent souvent des perms
 * cashier/driver ; si on teste cashier en premier, un admin se retrouve sur
 * l'écran caissier alors qu'il doit atterrir sur le portail admin.
 *
 * 'platform' (NEW) = super-admin du SaaS lui-même, jamais d'un tenant client.
 * Détecté via `userType=PLATFORM_ADMIN` OU perm `system.admin.platform`.
 */

export type MobilePortal =
  | 'platform'  // Super-admin SaaS (TransLog Pro lui-même)
  | 'admin'     // Admin tenant client + Manager Agence (scope serveur)
  | 'cashier'
  | 'driver'
  | 'station'
  | 'quai'
  | 'customer';

interface UserShape {
  userType:    string;
  permissions: string[];
  /** ID du tenant — utile pour détecter le tenant plateforme via slug. */
  tenantSlug?: string | null;
}

/** Slug interne du tenant plateforme (cf. PLATFORM_TENANT_ID backend). */
const PLATFORM_TENANT_SLUG = '__platform__';

/** Perms qui identifient SANS AMBIGUÏTÉ un super-admin plateforme. */
const PLATFORM_HINTS = [
  'system.admin.platform',
  'data.platform.metrics.read.global',
  'control.tenant.manage.global',
  'data.platform.kpi.business.read.global',
];

/** Perms qui identifient SANS AMBIGUÏTÉ un admin tenant (pas plateforme). */
const ADMIN_HINTS = [
  'control.iam.manage.tenant',
  'control.settings.manage.tenant',
  'control.module.install.tenant',
];

const DRIVER_HINTS = [
  'data.driver.rest.own',
  'data.trip.check.own',
  'data.trip.report.own',
  'data.trip.log_event.own',
];

const STATION_HINT = 'control.station.manage.tenant';
const QUAI_HINT    = 'control.quai.manage.tenant';

export function portalForUser(user: UserShape): MobilePortal {
  if (user.userType === 'CUSTOMER') return 'customer';
  const perms = new Set(user.permissions);
  const has = (p: string) => perms.has(p);

  // 1. Platform en priorité absolue — un super-admin ne doit JAMAIS atterrir
  //    sur un dashboard tenant commercial. Détecté via userType, slug du
  //    tenant plateforme, ou perms global-scope.
  if (
    user.userType === 'PLATFORM_ADMIN' ||
    user.tenantSlug === PLATFORM_TENANT_SLUG ||
    PLATFORM_HINTS.some(has)
  ) {
    return 'platform';
  }

  // 2. Admin tenant — sinon un TENANT_ADMIN avec perms cashier atterrit
  //    sur le mauvais portail.
  if (ADMIN_HINTS.some(has))  return 'admin';

  // 3. Driver
  if (DRIVER_HINTS.some(has)) return 'driver';

  // 4. Station
  if (has(STATION_HINT))      return 'station';

  // 5. Quai
  if (has(QUAI_HINT))         return 'quai';

  // 6. Cashier (rôle dédié — l'admin est filtré au-dessus)
  if (has('data.cashier.open.own') || has('data.cashier.transaction.own')) return 'cashier';

  return 'admin';
}
