/**
 * LoginPage — Page de connexion TranslogPro
 *
 * Formulaire email + mot de passe.
 * Appel : POST /api/auth/sign-in via useAuth().login()
 * Succès : redirect vers / (AdminDashboard)
 * Erreur : message inline, pas de page d'erreur séparée
 *
 * Accessibilité : WCAG 2.1 AA — aria-labels, focus visible, autocomplete
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState, type FormEvent } from 'react';
import { Bus } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';

// ─── Composant ────────────────────────────────────────────────────────────────

export function LoginPage({ onSuccess }: { onSuccess?: () => void }) {
  const { login } = useAuth();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      onSuccess?.();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 400) {
          setError('Email ou mot de passe incorrect.');
        } else {
          setError(`Erreur serveur (${err.status}). Réessayez dans un instant.`);
        }
      } else {
        setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 mb-4">
            <Bus className="w-8 h-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-white">TranslogPro</h1>
          <p className="text-slate-400 text-sm mt-1">Connectez-vous à votre espace</p>
        </div>

        {/* Formulaire */}
        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5"
        >
          {/* Message d'erreur */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 rounded-lg bg-red-950/60 border border-red-800 px-3 py-2.5 text-sm text-red-300"
            >
              <span aria-hidden className="mt-0.5">⚠</span>
              {error}
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-slate-300"
            >
              Adresse e-mail
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="prenom.nom@congosxpress.cg"
              className={cn(
                'w-full rounded-lg border bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500',
                'border-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                'disabled:opacity-50',
              )}
              disabled={loading}
            />
          </div>

          {/* Mot de passe */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-slate-300"
            >
              Mot de passe
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className={cn(
                'w-full rounded-lg border bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500',
                'border-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                'disabled:opacity-50',
              )}
              disabled={loading}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !email || !password}
            className={cn(
              'w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors',
              'hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-600">
          TranslogPro © 2026 — Tous droits réservés
        </p>
      </div>
    </div>
  );
}
