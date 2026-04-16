/**
 * resolvePortal — Décide sur quel portail atterrit un utilisateur.
 *
 * Seul endroit du frontend qui transforme (userType, permissions) → portalId.
 * Toute autre logique de navigation doit lire `usePortal()` et jamais
 * reproduire cette décision — sinon risque de divergence.
 *
 * Règles (ordre = priorité) :
 *   1. userType CUSTOMER              → customer
 *   2. perm platform/super-admin      → admin
 *   3. perm DRIVER_REST_OWN (.own)    → driver   (chauffeur = perm perso repos)
 *   4. perm station manage            → station-agent
 *   5. perm quai manage               → quai-agent
 *   6. fallback                        → admin  (staff agence)
 *
 * NB : la liste des portails auxquels un user a accès (pour le switcher)
 * est retournée par `listAccessiblePortals`. Un user multi-rôle voit
 * `resolvePortal` comme portail par défaut mais peut basculer.
 */

export type PortalId =
  | 'admin'
  | 'customer'
  | 'driver'
  | 'station-agent'
  | 'quai-agent';

export interface ResolvePortalInput {
  userType:    string;
  permissions: readonly string[];
}

// ─── Permissions pivots par portail ───────────────────────────────────────────
// Clés déclaratives — modifier ici = point unique de vérité.

// Perms qui identifient un admin (plateforme ou tenant). Ordre non
// significatif. Toute perm control.iam/settings tenant = admin.
const PERM_ADMIN_HINTS = [
  'system.admin.platform',
  'control.tenant.manage.global',
  'control.iam.manage.tenant',
  'control.settings.manage.tenant',
  'control.module.install.tenant',
];

// Perms qui identifient un chauffeur. Un user avec au moins une de ces perms
// est considéré chauffeur par défaut. `data.driver.rest.own` est la plus
// spécifique mais certains tenants n'activent pas le module repos — d'où
// le fallback sur les perms trip.*.own qui couvrent tous les chauffeurs.
// Perms spécifiques au rôle DRIVER (cf. prisma/seeds/iam.seed.ts rôle DRIVER).
// On évite `data.manifest.read.own` qui est partagé avec HOSTESS et AGENCY_MANAGER.
// TENANT_ADMIN a aussi ces perms, mais il matche PERM_ADMIN_HINTS en priorité.
const PERM_DRIVER_HINTS = [
  'data.driver.rest.own',
  'data.trip.check.own',
  'data.trip.report.own',
  'data.trip.log_event.own',
];

const PERM_STATION_HINT = 'control.station.manage.tenant';

const PERM_QUAI_HINT = 'control.quai.manage.tenant';

// ─── Résolveur ───────────────────────────────────────────────────────────────

export function resolvePortal(input: ResolvePortalInput): PortalId {
  const { userType, permissions } = input;
  const perms = new Set(permissions);

  if (userType === 'CUSTOMER')                      return 'customer';
  if (PERM_ADMIN_HINTS.some(p => perms.has(p)))     return 'admin';
  if (PERM_DRIVER_HINTS.some(p => perms.has(p)))    return 'driver';
  if (perms.has(PERM_STATION_HINT))                 return 'station-agent';
  if (perms.has(PERM_QUAI_HINT))                    return 'quai-agent';
  return 'admin';
}

// ─── Éligibilité (pour le switcher) ──────────────────────────────────────────
// Un user peut accéder à un portail sans en avoir fait le défaut.
// Exemple : un TENANT_ADMIN (admin par défaut) qui est aussi chauffeur peut
// basculer sur /driver pour faire ses propres check-in.

export function canAccessPortal(input: ResolvePortalInput, portal: PortalId): boolean {
  const { userType, permissions } = input;
  const perms = new Set(permissions);

  switch (portal) {
    case 'customer':       return userType === 'CUSTOMER';
    case 'admin':          return userType !== 'CUSTOMER';
    case 'driver':         return PERM_DRIVER_HINTS.some(p => perms.has(p));
    case 'station-agent':  return perms.has(PERM_STATION_HINT);
    case 'quai-agent':     return perms.has(PERM_QUAI_HINT);
  }
}

export function listAccessiblePortals(input: ResolvePortalInput): PortalId[] {
  const all: PortalId[] = ['admin', 'customer', 'driver', 'station-agent', 'quai-agent'];
  return all.filter(p => canAccessPortal(input, p));
}
