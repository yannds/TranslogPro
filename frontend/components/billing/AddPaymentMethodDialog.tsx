/**
 * AddPaymentMethodDialog — Modal d'ajout d'un moyen de paiement.
 *
 * Route serveur choisie selon le statut de la souscription :
 *   TRIAL / PAST_DUE → POST /api/v1/subscription/checkout     (facture + tokenise)
 *   ACTIVE           → POST /api/v1/subscription/setup-intent (tokenise sans débit)
 *
 * Dans les deux cas, le serveur renvoie une `paymentUrl` vers le PSP ; on
 * redirige. Au retour le reconciliation handler enregistre le nouveau moyen
 * dans `savedMethods[]` (dedup + promote default).
 *
 * MOBILE_MONEY : champ `phone` requis (E.164), stocké dans `metadata` et
 * propagé côté back pour la tokenisation MoMo (MTN/Airtel/Wave).
 */
import { useState } from 'react';
import {
  CreditCard, Smartphone, Landmark, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useTenantConfig } from '../../providers/TenantConfigProvider';

type Method = 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER';

/**
 * Mirror de `getSetupAmount` côté backend
 * (src/modules/subscription-checkout/subscription-checkout.service.ts).
 * Fallback XAF quand la devise tenant n'est pas supportée par les PSP.
 */
function resolveSetupAmount(tenantCurrency: string): { amount: number; currency: string } {
  switch (tenantCurrency) {
    case 'XAF':
    case 'XOF':
    case 'NGN': return { amount: 100, currency: tenantCurrency };
    case 'GHS': return { amount: 1,   currency: tenantCurrency };
    case 'KES': return { amount: 10,  currency: tenantCurrency };
    case 'USD': return { amount: 1,   currency: tenantCurrency };
    default:    return { amount: 100, currency: 'XAF' };
  }
}

interface Props {
  open:              boolean;
  onOpenChange:      (open: boolean) => void;
  /** Statut billing courant — détermine checkout vs setup-intent. */
  subscriptionStatus: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | string;
  /** Valeur par défaut du sélecteur. */
  defaultMethod?:    Method;
}

export function AddPaymentMethodDialog({
  open, onOpenChange, subscriptionStatus, defaultMethod = 'CARD',
}: Props) {
  const { t, lang } = useI18n();
  const { operational } = useTenantConfig();
  const [method,  setMethod]  = useState<Method>(defaultMethod);
  const [phone,   setPhone]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const useSetup = subscriptionStatus === 'ACTIVE';
  const endpoint = useSetup ? '/api/v1/subscription/setup-intent' : '/api/v1/subscription/checkout';

  const setup = resolveSetupAmount(operational.currency);
  const setupAmountFormatted = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', {
    style:                 'currency',
    currency:              setup.currency,
    maximumFractionDigits: setup.amount < 10 ? 2 : 0,
  }).format(setup.amount);

  async function submit() {
    setError(null);
    if (method === 'MOBILE_MONEY' && !/^\+?\d{7,15}$/.test(phone.replace(/\s/g, ''))) {
      setError(t('addPaymentMethod.invalidPhone'));
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { method };
      if (method === 'MOBILE_MONEY') body.customerPhone = phone.replace(/\s/g, '');
      const res = await apiFetch<{ paymentUrl?: string }>(endpoint, { method: 'POST', body });
      if (res.paymentUrl) {
        window.location.href = res.paymentUrl;
      } else {
        setError(t('addPaymentMethod.noPaymentUrl'));
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? String((err.body as { message?: string })?.message ?? err.message)
          : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  function MethodOption({ value, icon: Icon, label, hint }: {
    value: Method; icon: typeof CreditCard; label: string; hint: string;
  }) {
    const active = method === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => setMethod(value)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
          active
            ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
            : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
        )}
      >
        <span className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-full',
          active
            ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/60 dark:text-teal-200'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        )}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        </div>
      </button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('addPaymentMethod.title')}
      description={useSetup ? t('addPaymentMethod.setupDesc') : t('addPaymentMethod.checkoutDesc')}
      size="md"
    >
      <div className="space-y-4">
        {useSetup && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100"
          >
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('addPaymentMethod.refundNote', { amount: setupAmountFormatted })}</span>
          </div>
        )}

        <fieldset className="space-y-2" role="radiogroup" aria-label={t('addPaymentMethod.chooseMethod')}>
          <MethodOption
            value="CARD"
            icon={CreditCard}
            label={t('addPaymentMethod.card')}
            hint={t('addPaymentMethod.cardHint')}
          />
          <MethodOption
            value="MOBILE_MONEY"
            icon={Smartphone}
            label={t('addPaymentMethod.mobileMoney')}
            hint={t('addPaymentMethod.mobileMoneyHint')}
          />
          <MethodOption
            value="BANK_TRANSFER"
            icon={Landmark}
            label={t('addPaymentMethod.bank')}
            hint={t('addPaymentMethod.bankHint')}
          />
        </fieldset>

        {method === 'MOBILE_MONEY' && (
          <div className="space-y-1">
            <label htmlFor="momo-phone" className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {t('addPaymentMethod.phoneLabel')}
            </label>
            <input
              id="momo-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+242 06 123 45 67"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('addPaymentMethod.phoneHint')}
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={submit}
            disabled={busy || (method === 'MOBILE_MONEY' && phone.trim().length === 0)}
            className="inline-flex items-center gap-1.5"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('addPaymentMethod.submitting')}</>
              : <>{useSetup ? t('addPaymentMethod.submitSetup') : t('addPaymentMethod.submitCheckout')}</>}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
