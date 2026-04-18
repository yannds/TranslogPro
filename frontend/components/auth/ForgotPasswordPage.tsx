/**
 * ForgotPasswordPage — route publique /auth/forgot-password
 *
 * Flow : saisie email → POST /api/auth/password-reset/request.
 * Réponse toujours identique (on ne révèle pas si l'email existe).
 * L'utilisateur reçoit un email avec un lien /auth/reset?token=XYZ.
 *
 * Accessibilité : WCAG 2.1 AA, aria-live polite pour l'état succès.
 * Thème : cohérent LoginPage (slate-950, teal-600).
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bus, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { apiPost, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n/useI18n';

export function ForgotPasswordPage() {
  const { t }    = useI18n();
  const navigate = useNavigate();

  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/auth/password-reset/request', { email });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('auth.tooManyAttempts'));
      } else if (err instanceof ApiError && err.status === 400) {
        setError(t('auth.invalidEmail'));
      } else {
        setError(t('auth.networkError'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 mb-4">
            <Bus className="w-8 h-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('auth.forgotTitle')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('auth.forgotSubtitle')}</p>
        </div>

        {sent ? (
          <div
            role="status"
            aria-live="polite"
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-center"
          >
            <CheckCircle2 className="w-10 h-10 text-teal-500 mx-auto" aria-hidden />
            <p className="text-sm text-slate-300">{t('auth.forgotSentMessage')}</p>
            <p className="text-xs text-slate-500">{t('auth.forgotCheckSpam')}</p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className={cn(
                'w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white',
                'hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
              )}
            >
              {t('auth.backToLogin')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5"
          >
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

            <div className="space-y-1.5">
              <label
                htmlFor="forgot-email"
                className="block text-sm font-medium text-slate-300"
              >
                {t('auth.emailLabel')}
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="prenom.nom@translogpro.io"
                className={cn(
                  'w-full rounded-lg border bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500',
                  'border-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                  'disabled:opacity-50',
                )}
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className={cn(
                'w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors',
                'hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {loading ? t('auth.sending') : t('auth.sendResetLink')}
            </button>

            <div className="text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-teal-400"
              >
                <ArrowLeft className="w-3 h-3" aria-hidden />
                {t('auth.backToLogin')}
              </Link>
            </div>
          </form>
        )}

        <p className="text-center text-xs text-slate-600">{t('auth.copyright')}</p>
      </div>
    </div>
  );
}
