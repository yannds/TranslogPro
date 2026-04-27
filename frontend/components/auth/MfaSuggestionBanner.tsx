/**
 * MfaSuggestionBanner — banner non-bloquant pour suggérer l'activation MFA.
 *
 * Affiché dans AdminDashboard si `user.suggestedEnrollMfa = true`. Politique
 * 2026-04-27 : la friction d'un MFA obligatoire dès la 1re connexion est trop
 * forte pour le contexte Afrique centrale. On suggère sans bloquer.
 *
 * Dismissible via localStorage avec TTL 7 jours — réapparaît passé ce délai
 * tant que MFA n'est pas activé. Disparaît définitivement dès activation MFA.
 *
 * **Jamais affiché aux staff plateforme** (eux ont `mustEnrollMfa` qui les
 * redirige bloquant via ProtectedRoute).
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';

const STORAGE_KEY = 'mfa-suggestion-dismissed-until';
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export function MfaSuggestionBanner() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!user?.suggestedEnrollMfa) return;
    const dismissedUntil = Number(localStorage.getItem(STORAGE_KEY) ?? '0');
    if (dismissedUntil > Date.now()) setHidden(true);
  }, [user?.suggestedEnrollMfa]);

  if (!user?.suggestedEnrollMfa) return null;
  if (hidden) return null;

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now() + DISMISS_TTL_MS));
    setHidden(true);
  };

  return (
    <div className="px-4 pt-3 sm:px-6">
      <div
        role="region"
        aria-label={t('mfa.suggestion.aria')}
        className="flex flex-wrap items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/70 p-3 text-sm dark:border-blue-900/40 dark:bg-blue-950/30"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-blue-900 dark:text-blue-100">
            {t('mfa.suggestion.title')}
          </p>
          <p className="mt-0.5 text-xs text-blue-800/80 dark:text-blue-200/80">
            {t('mfa.suggestion.body')}
          </p>
        </div>
        <Link
          to="/account?tab=security"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          {t('mfa.suggestion.cta')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('mfa.suggestion.dismiss')}
          className="shrink-0 rounded-md p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/40"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
