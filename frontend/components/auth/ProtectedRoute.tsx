/**
 * ProtectedRoute — Garde de route basée sur la session
 *
 * Affiche :
 *   - Spinner de chargement pendant la vérification initiale
 *   - LoginPage si l'utilisateur n'est pas authentifié
 *   - Children si la session est valide
 *
 * Usage :
 *   <AuthProvider>
 *     <ProtectedRoute>
 *       <AdminDashboard />
 *     </ProtectedRoute>
 *   </AuthProvider>
 */

import { type ReactNode } from 'react';
import { Bus } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { LoginPage } from './LoginPage';

// ─── Spinner de chargement ────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Vérification de la session…"
      className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-950"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 animate-pulse">
        <Bus className="w-8 h-8 text-white" aria-hidden />
      </div>
      <p className="text-slate-400 text-sm">Chargement…</p>
    </div>
  );
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user)   return <LoginPage />;

  return <>{children}</>;
}
