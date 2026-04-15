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
import { AuthProvider }         from '../lib/auth/auth.context';
import { ProtectedRoute }       from '../components/auth/ProtectedRoute';
import { LoginPage }            from '../components/auth/LoginPage';
import { AdminDashboard }       from '../components/admin/AdminDashboard';

import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <TenantConfigProvider>
          <AuthProvider>
            <Routes>
              {/* Authentification */}
              <Route path="/login" element={<LoginPage />} />

              {/* Portail admin — protégé */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />

              {/* Racine → redirection vers dashboard */}
              <Route path="/" element={<Navigate to="/admin" replace />} />

              {/* Fallback toutes les routes inconnues */}
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </AuthProvider>
        </TenantConfigProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
