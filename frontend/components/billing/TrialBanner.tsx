/**
 * TrialBanner — bannière persistante quand le tenant est en phase d'essai.
 *
 * Fetch `/api/v1/subscription/summary` au mount, affiche :
 *   - rien si status !== 'TRIAL' ou si plus de 14 jours restants (pas d'urgence)
 *   - banner "info" 7-14 jours restants
 *   - banner "warning" 3-6 jours restants
 *   - banner "critical" < 3 jours ou expiré
 *
 * CTA "Choisir un moyen de paiement" → ouvre une modale minimale (méthode +
 * submit). Sur submit → POST /subscription/checkout → redirect vers paymentUrl.
 *
 * Dismiss : masqué 24h si user clique "Plus tard". Persistance localStorage.
 */
import { useEffect, useState } from 'react';
import { CreditCard, Clock, X, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

interface BillingSummary {
  status:             string; // TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED
  trialEndsAt:        string | null;
  trialDaysLeft:      number | null;
  currentPeriodEnd:   string | null;
  /** Seuil (en jours) au-dessus duquel on n'affiche pas le banner — piloté par
   *  PlatformConfig côté backend, remonté ici pour éviter le magic number UI. */
  trialBannerMaxDaysLeft?: number;
  plan: null | {
    slug:         string;
    name:         string;
    price:        number;
    currency:     string;
    billingCycle: string;
  };
}

const DISMISS_KEY = 'trial-banner-dismissed';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function TrialBanner() {
  const { t, lang } = useI18n();
  const [data, setData] = useState<BillingSummary | null>(null);
  const [dismissed, setDismissed] = useState(() => wasDismissedRecently());
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    apiFetch<BillingSummary>('/api/v1/subscription/summary', { skipRedirectOn401: true })
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!data || data.status !== 'TRIAL' || !data.plan || dismissed) return null;
  if (data.plan.price <= 0) return null; // plan gratuit ou devis → pas de banner

  const daysLeft = data.trialDaysLeft ?? 30;
  // Seuil d'affichage pilotée par PlatformConfig (`trial.banner.maxDaysLeft`,
  // défaut 14). Pas de valeur en dur côté UI.
  const maxDaysLeft = data.trialBannerMaxDaysLeft ?? 14;
  if (daysLeft > maxDaysLeft) return null;

  // Paliers info/warning/critical calculés à partir du seuil max — gardent
  // toujours la même proportion quelle que soit la config (p.ex. 7 j si max=14,
  // 10 j si max=21). Évite de multiplier les clés config pour peu d'agilité.
  const warnAt = Math.ceil(maxDaysLeft / 2);
  const critAt = Math.max(3, Math.ceil(maxDaysLeft / 5));
  const severity: 'info' | 'warning' | 'critical' =
    daysLeft >= warnAt ? 'info' :
    daysLeft >= critAt ? 'warning' : 'critical';

  const toneCls = {
    info:     'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100',
    warning:  'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100',
    critical: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100',
  }[severity];

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* quota */ }
    setDismissed(true);
  };

  const priceLabel = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 0 })
    .format(data.plan.price);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
          toneCls,
        )}
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">
              {daysLeft > 0
                ? t('billing.trial.daysLeft').replace('{n}', String(daysLeft))
                : t('billing.trial.expired')}
            </strong>
            {' · '}
            {t('billing.trial.subtitle')
              .replace('{plan}', data.plan.name)
              .replace('{price}', `${priceLabel} ${data.plan.currency}`)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          >
            <CreditCard className="h-3.5 w-3.5" aria-hidden />
            {t('billing.trial.cta')}
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('billing.trial.later')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <CheckoutDialog onClose={() => setCheckoutOpen(false)} plan={data.plan} />
      )}
    </>
  );
}

// ─── Minimal checkout dialog ────────────────────────────────────────────────

type Method = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER';

function CheckoutDialog({ onClose, plan }: { onClose: () => void; plan: NonNullable<BillingSummary['plan']> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<Method>('CARD');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr(null);
    try {
      const res = await apiFetch<{ paymentUrl?: string }>('/api/v1/subscription/checkout', {
        method: 'POST',
        body:   { method },
        skipRedirectOn401: true,
      });
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
      } else {
        setErr(t('billing.checkout.noUrl'));
        setLoading(false);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? t('billing.checkout.error') : t('billing.checkout.error');
      setErr(msg);
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-checkout-title"
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="billing-checkout-title" className="text-lg font-semibold text-slate-900 dark:text-white">
          {t('billing.checkout.title').replace('{plan}', plan.name)}
        </h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {t('billing.checkout.subtitle')
            .replace('{price}', String(plan.price))
            .replace('{currency}', plan.currency)}
        </p>

        <form onSubmit={onSubmit} className="mt-5">
          <fieldset>
            <legend className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('billing.checkout.method')}
            </legend>
            <div className="space-y-2">
              {(['CARD', 'MOBILE_MONEY', 'BANK_TRANSFER'] as Method[]).map(m => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors',
                    method === m
                      ? 'border-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100'
                      : 'border-slate-200 hover:border-teal-300 dark:border-slate-700',
                  )}
                >
                  <input type="radio" name="method" value={m}
                    checked={method === m} onChange={() => setMethod(m)} className="sr-only" />
                  <span className="font-medium">{t(`billing.method.${m}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {err && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{err}</span>
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={loading}
              className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              {t('billing.checkout.cancel')}
            </button>
            <button type="submit" disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-600 px-5 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60">
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('billing.checkout.submitting')}</>
                : <><CreditCard className="h-4 w-4" aria-hidden /> {t('billing.checkout.submit')}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function wasDismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < ONE_DAY_MS;
  } catch { return false; }
}
