/**
 * main.tsx — Point d'entrée TranslogPro (Vite + React 18)
 *
 * Arbre de providers :
 *   ThemeProvider          → dark mode persistant, zero FOUC
 *   TenantConfigProvider   → couleurs/devise/timezone par tenant
 *   AuthProvider           → session cookie, /api/auth/me
 *     ProtectedRoute       → LoginPage si non authentifié
 *       AdminDashboard     → portail complet
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider }       from '../components/theme/ThemeProvider';
import { TenantConfigProvider } from '../providers/TenantConfigProvider';
import { AuthProvider }        from '../lib/auth/auth.context';
import { ProtectedRoute }      from '../components/auth/ProtectedRoute';
import { AdminDashboard }      from '../components/admin/AdminDashboard';

// Tailwind CSS (doit être importé ici pour que Vite le bundle)
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system">
      <TenantConfigProvider>
        <AuthProvider>
          <ProtectedRoute>
            <AdminDashboard />
          </ProtectedRoute>
        </AuthProvider>
      </TenantConfigProvider>
    </ThemeProvider>
  </StrictMode>,
);
