/**
 * main.tsx — Point d'entrée TranslogPro (Vite + React 18 + React Router v7)
 *
 * Arbre de providers :
 *   BrowserRouter          → routing URL
 *     ThemeProvider        → dark mode forcé, zero FOUC
 *       TenantConfigProvider → couleurs/devise/timezone par tenant
 *         AuthProvider     → session cookie, /api/auth/me
 *           Routes         → /login | /admin/* | /
 */

import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import { ThemeProvider }        from '../components/theme/ThemeProvider';
import { TenantConfigProvider } from '../providers/TenantConfigProvider';
import { TenantConfigBridge }   from '../providers/TenantConfigBridge';
import { I18nProvider }         from '../providers/I18nProvider';
import { AuthProvider }         from '../lib/auth/auth.context';
import { TenantScopeProvider }  from '../lib/platform-scope/TenantScopeProvider';
import { ProtectedRoute }       from '../components/auth/ProtectedRoute';
import { LoginPage }            from '../components/auth/LoginPage';
import { ForgotPasswordPage }   from '../components/auth/ForgotPasswordPage';
import { ResetPasswordPage }    from '../components/auth/ResetPasswordPage';
import { AdminDashboard }       from '../components/admin/AdminDashboard';
import { CustomerDashboard }    from '../components/customer/CustomerDashboard';
import { DriverDashboard }      from '../components/driver/DriverDashboard';
import { StationAgentDashboard } from '../components/station-agent/StationAgentDashboard';
import { QuaiAgentDashboard }   from '../components/quai-agent/QuaiAgentDashboard';
import { LegacyTenantRedirect } from '../components/legacy/LegacyTenantRedirect';
import { PageClaim }            from '../components/pages/PageClaim';
import { PageAccount }          from '../components/pages/PageAccount';
// Routes publiques lazy — réduit le bundle initial `index.js` (~2.3 MB → ~1.4 MB)
// en sortant landing + signup + onboarding + welcome dans leurs propres chunks
// chargés à la demande. Affichés derrière un Suspense pour éviter les flashs.
const PublicLanding    = lazy(() => import('../components/public/PublicLanding').then(m => ({ default: m.PublicLanding })));
const PublicSignup     = lazy(() => import('../components/public/PublicSignup').then(m => ({ default: m.PublicSignup })));
const PublicReport     = lazy(() => import('../components/public/PublicReport').then(m => ({ default: m.PublicReport })));
const OnboardingWizard = lazy(() => import('../components/onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));
const WelcomePage      = lazy(() => import('../components/onboarding/WelcomePage').then(m => ({ default: m.WelcomePage })));
// Portail voyageur — gros composant (Leaflet, hero carousel, paiements) rendu
// uniquement pour les visiteurs anonymes sur un sous-domaine tenant. On le
// sort aussi du bundle initial pour décharger l'app admin.
const PortailVoyageur  = lazy(() => import('../components/portail-voyageur/PortailVoyageur').then(m => ({ default: m.PortailVoyageur })));

/**
 * Fallback utilisé derrière Suspense pour les routes publiques lazy.
 * Spinner discret, thème-agnostique (dark via classe html.dark).
 */
function PublicLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-slate-950" role="status" aria-label="Chargement">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent motion-reduce:animate-none" aria-hidden />
    </div>
  );
}
import { useAuth }              from '../lib/auth/auth.context';
import { resolvePortal }        from '../lib/navigation/resolvePortal';
import type { PortalId }        from '../lib/navigation/resolvePortal';
import { resolveHost }          from '../lib/tenancy/host';

/**
 * Redirige vers le portail correspondant à (userType, permissions) via
 * `resolvePortal` — seul endroit du frontend qui fait ce choix. Tout le reste
 * doit rester additif et ne pas recalculer un portail autre part.
 */
const PORTAL_TO_PATH: Record<PortalId, string> = {
  admin:           '/admin',
  customer:        '/customer',
  driver:          '/driver',
  'station-agent': '/agent',
  'quai-agent':    '/quai',
};

const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;

  // Phase 1 multi-tenant : sur un sous-domaine tenant, l'anonyme atterrit sur le
  // portail voyageur. Sur l'apex (ou sous-domaine réservé non-admin), il atterrit
  // sur la landing marketing SaaS. Le /login reste accessible directement.
  if (!user) {
    const host = resolveHost();
    if (host.slug) {
      return (
        <Suspense fallback={<PublicLoading />}>
          <PortailVoyageur />
        </Suspense>
      );
    }
    if (host.isAdmin) return <Navigate to="/login" replace />;
    return (
      <Suspense fallback={<PublicLoading />}>
        <PublicLanding />
      </Suspense>
    );
  }

  const portal = resolvePortal({ userType: user.userType, permissions: user.permissions });
  // Le staff du tenant plateforme (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2)
  // atterrit directement sur son dashboard plateforme — le dashboard tenant
  // standard est vide pour lui (permissions globales ≠ scope tenant).
  if (portal === 'admin' && user.tenantId === PLATFORM_TENANT_ID) {
    return <Navigate to="/admin/platform/dashboard" replace />;
  }
  // Admin tenant qui n'a pas encore terminé l'onboarding → wizard obligatoire
  // (reprise si interrompu). Les autres portails (cashier, driver, etc.) ne
  // sont pas concernés — le wizard est réservé au TENANT_ADMIN via permissions.
  if (portal === 'admin' && !(user as any).onboardingCompletedAt) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Navigate to={PORTAL_TO_PATH[portal]} replace />;
}

import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import './index.css';

// Démarre la boucle de synchronisation offline (replay de la outbox dès que
// le browser est online). Le service worker PWA est enregistré automatiquement
// par vite-plugin-pwa (au build + en prod).
import { startSyncLoop } from '../lib/offline/outbox';
startSyncLoop();

// Telemetry : capture globale des erreurs. Driver par défaut = console.
// Pour prod, ajouter un driver Sentry via setTelemetryDriver() ici après init DSN.
import { installGlobalErrorCapture } from '../lib/telemetry/telemetry';
installGlobalErrorCapture();

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

// HMR guard — en dev Vite, un full-page Fast Refresh peut ré-exécuter main.tsx
// et créer un 2e root sur le même container, ce qui émet le warning "You are
// calling ReactDOMClient.createRoot() on a container that has already been
// passed to createRoot() before". On mémorise le root sur l'élément DOM et
// on réutilise son render() si déjà présent.
interface ReactRootContainer extends HTMLElement { _reactRoot?: ReturnType<typeof createRoot> }
const container = root as ReactRootContainer;
const reactRoot = container._reactRoot ?? createRoot(root);
container._reactRoot = reactRoot;

reactRoot.render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TenantConfigProvider>
          <I18nProvider>
          <AuthProvider>
            <TenantConfigBridge />
            <TenantScopeProvider>
            <Routes>
              {/* Authentification */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/reset" element={<ResetPasswordPage />} />

              {/* Portail admin — protégé (STAFF / SUPER_ADMIN).
                  `portal="admin"` bloque les CUSTOMER qui tenteraient l'URL
                  et les renvoie vers leur portail. */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute portal="admin">
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail client — protégé (CUSTOMER uniquement). Un STAFF qui
                  atterrirait ici est renvoyé vers son portail (admin/driver/…). */}
              <Route
                path="/customer/*"
                element={
                  <ProtectedRoute portal="customer">
                    <CustomerDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail chauffeur — nécessite une perm DRIVER_HINTS.
                  Un admin sans perm chauffeur qui tape /driver est renvoyé
                  vers /admin automatiquement. */}
              <Route
                path="/driver/*"
                element={
                  <ProtectedRoute portal="driver">
                    <DriverDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail agent de gare — perm control.station.manage.tenant requise. */}
              <Route
                path="/agent/*"
                element={
                  <ProtectedRoute portal="station-agent">
                    <StationAgentDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail agent de quai — perm control.quai.manage.tenant requise. */}
              <Route
                path="/quai/*"
                element={
                  <ProtectedRoute portal="quai-agent">
                    <QuaiAgentDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Legacy : ancien portail par path `/p/:slug/*` — redirige vers le
                  sous-domaine `{slug}.translogpro.com/*` (Phase 1 cutover).
                  Composant client-side pour forcer un vrai changement d'origine
                  (le cookie tenant ne suit pas — désiré). */}
              <Route path="/p/:tenantSlug/*" element={<LegacyTenantRedirect />} />

              {/* Claim CRM — magic link "revendication" d'historique shadow */}
              <Route path="/claim" element={<PageClaim />} />

              {/* Self-service compte : mot de passe, MFA, préférences (langue/TZ).
                  Accessible à tous les rôles authentifiés — PageAccount n'impose
                  aucune permission en plus de la session. */}
              <Route
                path="/account"
                element={
                  <ProtectedRoute>
                    <PageAccount />
                  </ProtectedRoute>
                }
              />

              {/* Signup SaaS public — wizard 3 étapes. Accessible partout (apex +
                  sous-domaines réservés), le wizard configure lui-même le tenant. */}
              <Route
                path="/signup"
                element={
                  <Suspense fallback={<PublicLoading />}>
                    <PublicSignup />
                  </Suspense>
                }
              />

              {/* Portail citoyen : signalement anonyme (pas d'auth). tenantId
                  résolu côté backend depuis le Host (sous-domaine transporteur). */}
              <Route
                path="/report"
                element={
                  <Suspense fallback={<PublicLoading />}>
                    <PublicReport />
                  </Suspense>
                }
              />

              {/* Onboarding wizard post-signup (tenant admin uniquement) —
                  ProtectedRoute enforce la session, le wizard enforce la perm
                  côté backend pour chaque endpoint. */}
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<PublicLoading />}>
                      <OnboardingWizard />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/welcome"
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<PublicLoading />}>
                      <WelcomePage />
                    </Suspense>
                  </ProtectedRoute>
                }
              />

              {/* Racine → redirection contextuelle selon userType */}
              <Route path="/" element={<HomeRedirect />} />

              {/* Fallback toutes les routes inconnues */}
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
            </TenantScopeProvider>
          </AuthProvider>
          </I18nProvider>
        </TenantConfigProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
