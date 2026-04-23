/**
 * SuspendedScreen — verrouille l'app admin quand la souscription est SUSPENDED.
 *
 * Déclencheur : `user.subscriptionStatus === 'SUSPENDED'` (exposé par
 * `/api/auth/me` → AuthUserDto).
 *
 * Comportement :
 *   - Overlay plein écran non-fermable (pas de bouton X) — accès bloqué
 *     tant que le paiement n'est pas régularisé.
 *   - Exceptions : /admin/billing (on laisse l'admin payer) et /welcome.
 *   - CTA principal → /admin/billing. Sign-out disponible.
 *   - Rassure sur la préservation des données (rien n'est perdu).
 *
 * Déjà handled :
 *   - Escalade automatique : SubscriptionDunningService passe la sub en
 *     SUSPENDED après 10 jours PAST_DUE (3 rappels envoyés entre temps).
 *   - Reconciliation : un paiement réussi bascule SUSPENDED → ACTIVE dans
 *     SubscriptionReconciliationService.
 */
import { useLocation, Link } from 'react-router-dom';
import { Lock, CreditCard, LogOut, ShieldAlert, Download } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';

/** Routes où l'écran ne se montre PAS — toujours accessibles à l'admin. */
const ALLOWED_ROUTES = ['/admin/billing', '/welcome', '/login'];
/** En CANCELLED : seul l'export RGPD est accessible en plus du billing. */
const CANCELLED_ALLOWED_ROUTES = [...ALLOWED_ROUTES, '/admin/settings/backup'];

export function SuspendedScreen() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();

  const status = (user as any)?.subscriptionStatus as string | undefined;
  if (status !== 'SUSPENDED' && status !== 'CANCELLED') return null;

  const allowed = status === 'CANCELLED'
    ? CANCELLED_ALLOWED_ROUTES
    : ALLOWED_ROUTES;
  if (allowed.some(r => pathname.startsWith(r))) return null;

  const isCancelled = status === 'CANCELLED';

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="suspended-title"
      aria-describedby="suspended-body"
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 shadow-2xl dark:border-red-900/70 dark:bg-slate-900 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-300">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 id="suspended-title" className="text-lg font-semibold text-slate-900 dark:text-white">
              {isCancelled ? t('cancelled.title') : t('suspended.title')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {isCancelled ? t('cancelled.subtitle') : t('suspended.subtitle')}
            </p>
          </div>
        </div>

        <p id="suspended-body" className="mt-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {isCancelled ? t('cancelled.body') : t('suspended.body')}
        </p>

        <div className="mt-5 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{isCancelled ? t('cancelled.dataSafe') : t('suspended.dataSafe')}</span>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t('suspended.logout')}
          </button>
          {isCancelled ? (
            <Link
              to="/admin/settings/backup"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-teal-600 px-5 text-sm font-semibold text-white shadow-lg shadow-teal-600/30 hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t('cancelled.exportCta')}
            </Link>
          ) : (
            <Link
              to="/admin/billing"
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-red-600 px-5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              <CreditCard className="h-4 w-4" aria-hidden />
              {t('suspended.cta')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
