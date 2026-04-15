/**
 * ProtectedRoute — Garde de route basée sur la session
 *
 * Comportement :
 *   - Spinner de chargement pendant la vérification de session initiale
 *   - Redirection vers /login (React Router Navigate) si non authentifié
 *   - Children si la session est valide
 *
 * Usage :
 *   <Route path="/admin/*" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
 */

import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Bus } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';

// ─── Spinner de chargement ────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Vérification de la session…"
      aria-live="polite"
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
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!user) {
    // Mémorise l'URL cible pour rediriger après connexion
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
