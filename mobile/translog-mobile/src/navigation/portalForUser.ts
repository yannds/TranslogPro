/**
 * Portail cible selon les permissions de l'utilisateur.
 * Aligné sur `frontend/lib/navigation/resolvePortal.ts`.
 *
 * ORDRE CRITIQUE : admin > driver > station > quai > cashier > (fallback admin).
 * Les rôles admin (TENANT_ADMIN, SUPER_ADMIN) héritent souvent des perms
 * cashier/driver ; si on teste cashier en premier, un admin se retrouve sur
 * l'écran caissier alors qu'il doit atterrir sur le portail admin.
 */

export type MobilePortal = 'admin' | 'cashier' | 'driver' | 'station' | 'quai' | 'customer';

interface UserShape {
  userType: string;
  permissions: string[];
}

// Perms qui identifient SANS AMBIGUÏTÉ un admin (plateforme ou tenant).
// Aucune autre rôle ne les a — si présentes, on route vers /admin.
const ADMIN_HINTS = [
  'system.admin.platform',
  'control.tenant.manage.global',
  'control.iam.manage.tenant',
  'control.settings.manage.tenant',
  'control.module.install.tenant',
];

// Perms spécifiques DRIVER (cf. frontend/resolvePortal.ts)
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

  // 1. Admin en priorité — sinon un TENANT_ADMIN avec perms cashier atterrit
  //    sur le mauvais portail.
  if (ADMIN_HINTS.some(has))  return 'admin';

  // 2. Driver
  if (DRIVER_HINTS.some(has)) return 'driver';

  // 3. Station
  if (has(STATION_HINT))      return 'station';

  // 4. Quai
  if (has(QUAI_HINT))         return 'quai';

  // 5. Cashier (rôle dédié — l'admin est filtré au-dessus)
  if (has('data.cashier.open.own') || has('data.cashier.transaction.own')) return 'cashier';

  return 'admin';
}
