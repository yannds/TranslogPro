/**
 * ProtectedRoute — Garde de route basée sur la session + portail.
 *
 * Comportement :
 *   - Spinner de chargement pendant la vérification de session initiale
 *   - Redirection vers /login (React Router Navigate) si non authentifié
 *   - Si `portal` fourni ET le user ne peut pas y accéder (cf. `canAccessPortal`),
 *     redirige vers son portail résolu par défaut (`resolvePortal`). Évite
 *     qu'un chauffeur atterrisse sur /admin en tapant l'URL à la main.
 *   - Children si tout est OK.
 *
 * Usage :
 *   <Route path="/admin/*"  element={<ProtectedRoute portal="admin"><AdminDashboard /></ProtectedRoute>} />
 *   <Route path="/driver/*" element={<ProtectedRoute portal="driver"><DriverDashboard /></ProtectedRoute>} />
 *   <Route path="/account"  element={<ProtectedRoute><PageAccount /></ProtectedRoute>} />  (accès libre)
 */

import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Bus } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { resolvePortal, type PortalId } from '../../lib/navigation/resolvePortal';

// Map portalId → path cible. Point unique de vérité, identique à celui
// consommé par HomeRedirect dans main.tsx.
const PORTAL_TO_PATH: Record<PortalId, string> = {
  admin:           '/admin',
  customer:        '/customer',
  driver:          '/driver',
  'station-agent': '/agent',
  'quai-agent':    '/quai',
};

// ─── Spinner de chargement ────────────────────────────────────────────────────

function LoadingScreen() {
  const { t } = useI18n();

  return (
    <div
      role="status"
      aria-label={t('auth.sessionCheck')}
      aria-live="polite"
      className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 animate-pulse">
        <Bus className="w-8 h-8 text-white" aria-hidden />
      </div>
      <p className="text-slate-400 text-sm">{t('auth.loading')}</p>
    </div>
  );
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function ProtectedRoute({
  children, portal,
}: {
  children: ReactNode;
  /**
   * Si défini, vérifie que l'utilisateur a bien le droit d'accéder à ce
   * portail. Sinon, redirection silencieuse vers son portail par défaut.
   * Omettre pour une route partagée (ex. /account accessible à tous les rôles).
   */
  portal?: PortalId;
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!user) {
    // Mémorise l'URL cible pour rediriger après connexion
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // MFA enrollment forcé pour rôles haut-privilège (TENANT_ADMIN etc.)
  // Bloquant : tant que MFA n'est pas activé, l'utilisateur ne peut accéder
  // qu'à /account (onglet security) — le reste de l'app est inaccessible.
  if (user.mustEnrollMfa && !location.pathname.startsWith('/account')) {
    return <Navigate to="/account?tab=security" replace />;
  }

  // Portal guard — **strict par défaut** :
  //   - un chauffeur qui tape /admin est renvoyé vers /driver
  //   - un admin qui tape /driver est renvoyé vers /admin
  //     (même s'il HÉRITE de perms driver .own — ex. TENANT_ADMIN qui peut
  //     faire ses propres check-in → `canAccessPortal(driver)` = true, mais
  //     ce n'est PAS son portail principal)
  //
  // Règle appliquée : le portail courant DOIT être celui résolu par
  // `resolvePortal` pour l'utilisateur. Si un admin veut basculer sur le
  // portail driver, il doit utiliser le switcher explicite qui posera un
  // flag storage/query (non implémenté ici — à ajouter si besoin).
  //
  // L'ordre résolu dans resolvePortal est : platform > admin > driver >
  // station > quai > fallback admin. Un TENANT_ADMIN (qui a
  // `control.iam.manage.tenant`) ressort toujours 'admin', peu importe
  // ses perms .own héritées.
  if (portal) {
    const input    = { userType: user.userType, permissions: user.permissions };
    const resolved = resolvePortal(input);
    if (portal !== resolved) {
      return <Navigate to={PORTAL_TO_PATH[resolved]} replace />;
    }
  }

  return <>{children}</>;
}
