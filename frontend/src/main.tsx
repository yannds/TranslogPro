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
import { ProtectedRoute }       from '../components/auth/ProtectedRoute';
import { LoginPage }            from '../components/auth/LoginPage';
import { AdminDashboard }       from '../components/admin/AdminDashboard';
import { CustomerDashboard }    from '../components/customer/CustomerDashboard';
import { useAuth }              from '../lib/auth/auth.context';

/**
 * Redirige vers le portail correspondant au userType :
 *   CUSTOMER → /customer
 *   STAFF / autres → /admin
 * Évite qu'un client connecté atterrisse sur l'admin (et inversement).
 */
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  const target = user?.userType === 'CUSTOMER' ? '/customer' : '/admin';
  return <Navigate to={target} replace />;
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
            <Routes>
              {/* Authentification */}
              <Route path="/login" element={<LoginPage />} />

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

              {/* Racine → redirection contextuelle selon userType */}
              <Route path="/" element={<HomeRedirect />} />

              {/* Fallback toutes les routes inconnues */}
              <Route path="*" element={<HomeRedirect />} />
            </Routes>
          </AuthProvider>
          </I18nProvider>
        </TenantConfigProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
