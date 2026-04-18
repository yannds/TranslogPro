/**
 * ResetPasswordPage — route publique /auth/reset?token=XYZ
 *
 * Flow : saisie nouveau mot de passe + confirmation → POST
 * /api/auth/password-reset/complete. Token récupéré depuis la query-string.
 *
 * Sécurité :
 *   - token jamais affiché ni loggué côté client
 *   - minLength 8 (aligné backend)
 *   - confirmation visuelle pour prévenir les erreurs de saisie
 */

import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiPost, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n/useI18n';

export function ResetPasswordPage() {
  const { t }    = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token    = params.get('token') ?? '';

  const [pw1,     setPw1]     = useState('');
  const [pw2,     setPw2]     = useState('');
  const [loading, setLoading] = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const mismatch = pw1.length > 0 && pw2.length > 0 && pw1 !== pw2;
  const tooShort = pw1.length > 0 && pw1.length < 8;
  const canSubmit = !!token && pw1.length >= 8 && pw1 === pw2;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiPost('/api/auth/password-reset/complete', { token, newPassword: pw1 });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) setError(t('auth.resetTokenInvalid'));
        else if (err.status === 429) setError(t('auth.tooManyAttempts'));
        else setError(err.message);
      } else {
        setError(t('auth.networkError'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" aria-hidden />
          <h1 className="text-xl font-bold text-white">{t('auth.resetTokenMissing')}</h1>
          <Link
            to="/auth/forgot-password"
            className="text-sm text-teal-400 hover:text-teal-300"
          >
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-600 mb-4">
            <Bus className="w-8 h-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-white">{t('auth.resetTitle')}</h1>
          <p className="text-slate-400 text-sm mt-1">{t('auth.resetSubtitle')}</p>
        </div>

        {done ? (
          <div
            role="status"
            aria-live="polite"
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-center"
          >
            <CheckCircle2 className="w-10 h-10 text-teal-500 mx-auto" aria-hidden />
            <p className="text-sm text-slate-300">{t('auth.resetDoneMessage')}</p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className={cn(
                'w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white',
                'hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
              )}
            >
              {t('auth.goToLogin')}
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
              <label htmlFor="reset-pw1" className="block text-sm font-medium text-slate-300">
                {t('auth.newPasswordLabel')}
              </label>
              <input
                id="reset-pw1"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw1}
                onChange={e => setPw1(e.target.value)}
                aria-invalid={tooShort || undefined}
                aria-describedby={tooShort ? 'reset-pw1-hint' : undefined}
                className={cn(
                  'w-full rounded-lg border bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500',
                  'border-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                  'disabled:opacity-50',
                )}
                disabled={loading}
              />
              {tooShort && (
                <p id="reset-pw1-hint" className="text-xs text-amber-400">{t('auth.passwordMinLength')}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="reset-pw2" className="block text-sm font-medium text-slate-300">
                {t('auth.confirmPasswordLabel')}
              </label>
              <input
                id="reset-pw2"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? 'reset-pw2-hint' : undefined}
                className={cn(
                  'w-full rounded-lg border bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500',
                  'border-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                  'disabled:opacity-50',
                )}
                disabled={loading}
              />
              {mismatch && (
                <p id="reset-pw2-hint" className="text-xs text-amber-400">{t('auth.passwordMismatch')}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className={cn(
                'w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white transition-colors',
                'hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {loading ? t('auth.resetting') : t('auth.resetPassword')}
            </button>
          </form>
        )}

        <p className="text-center text-xs text-slate-600">{t('auth.copyright')}</p>
      </div>
    </div>
  );
}
