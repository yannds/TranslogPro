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

import { StrictMode } from 'react';
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
import { PortailVoyageur }      from '../components/portail-voyageur/PortailVoyageur';
import { PageClaim }            from '../components/pages/PageClaim';
import { useAuth }              from '../lib/auth/auth.context';
import { resolvePortal }        from '../lib/navigation/resolvePortal';
import type { PortalId }        from '../lib/navigation/resolvePortal';

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
  if (!user) return <Navigate to="/login" replace />;
  const portal = resolvePortal({ userType: user.userType, permissions: user.permissions });
  // Le staff du tenant plateforme (SUPER_ADMIN / SUPPORT_L1 / SUPPORT_L2)
  // atterrit directement sur son dashboard plateforme — le dashboard tenant
  // standard est vide pour lui (permissions globales ≠ scope tenant).
  if (portal === 'admin' && user.tenantId === PLATFORM_TENANT_ID) {
    return <Navigate to="/admin/platform/dashboard" replace />;
  }
  return <Navigate to={PORTAL_TO_PATH[portal]} replace />;
}

import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

createRoot(root).render(
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

              {/* Portail admin — protégé (STAFF / SUPER_ADMIN) */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail client — protégé (CUSTOMER) */}
              <Route
                path="/customer/*"
                element={
                  <ProtectedRoute>
                    <CustomerDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail chauffeur — protégé (STAFF avec perms trip.*.own) */}
              <Route
                path="/driver/*"
                element={
                  <ProtectedRoute>
                    <DriverDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail agent de gare — protégé */}
              <Route
                path="/agent/*"
                element={
                  <ProtectedRoute>
                    <StationAgentDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail agent de quai — protégé */}
              <Route
                path="/quai/*"
                element={
                  <ProtectedRoute>
                    <QuaiAgentDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Portail public voyageur — sans auth, white-label par tenant */}
              <Route path="/p/:tenantSlug/*" element={<PortailVoyageur />} />

              {/* Claim CRM — magic link "revendication" d'historique shadow */}
              <Route path="/claim" element={<PageClaim />} />

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
