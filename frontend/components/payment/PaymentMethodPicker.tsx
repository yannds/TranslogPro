/**
 * PaymentMethodPicker — radio-cards des moyens de paiement.
 *
 * WCAG AA :
 *   - `role="radiogroup"` + labels associés (htmlFor)
 *   - navigation clavier (flèches, espace/entrée)
 *   - focus visible (Tailwind ring-*)
 *
 * Dark/Light : classes `dark:` systématiques.
 * i18n      : labels via t('payment.method.*').
 *
 * Source des méthodes : backend PaymentMethodConfig (par pays du tenant).
 */
import { useEffect, useMemo, useState } from 'react';
import { Smartphone, CreditCard, Building2, Hash } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import type { PaymentMethod } from './usePaymentIntent';

export interface PaymentMethodOption {
  providerId:  string;  // 'mtn_momo', 'card_visa', …
  displayName: string;
  type:        PaymentMethod;
  logoUrl:     string | null;
  phonePrefix: string | null;
}

interface Props {
  options:    PaymentMethodOption[];
  value?:     string;                 // providerId sélectionné
  onChange:   (opt: PaymentMethodOption) => void;
  disabled?:  boolean;
}

const TYPE_ICON: Record<PaymentMethod, typeof Smartphone> = {
  MOBILE_MONEY:  Smartphone,
  CARD:          CreditCard,
  BANK_TRANSFER: Building2,
  USSD:          Hash,
};

export function PaymentMethodPicker({ options, value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const [internal, setInternal] = useState<string | undefined>(value);
  useEffect(() => setInternal(value), [value]);

  const byType = useMemo(() => {
    const groups = new Map<PaymentMethod, PaymentMethodOption[]>();
    for (const o of options) {
      const list = groups.get(o.type) ?? [];
      list.push(o); groups.set(o.type, list);
    }
    return groups;
  }, [options]);

  const select = (opt: PaymentMethodOption) => {
    if (disabled) return;
    setInternal(opt.providerId);
    onChange(opt);
  };

  if (options.length === 0) {
    return (
      <div
        role="status"
        className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center text-sm text-gray-500 dark:text-gray-400"
      >
        {t('payment.noMethodsAvailable')}
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label={t('payment.chooseMethod')} className="space-y-6">
      {Array.from(byType.entries()).map(([type, list]) => {
        const Icon = TYPE_ICON[type];
        return (
          <div key={type} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <Icon className="w-4 h-4" aria-hidden="true" />
              {t(`payment.method.${type}`)}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map(opt => {
                const selected = internal === opt.providerId;
                return (
                  <label
                    key={opt.providerId}
                    htmlFor={`pm-${opt.providerId}`}
                    className={[
                      'relative flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition',
                      'focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2',
                      'dark:focus-within:ring-offset-gray-900',
                      selected
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500',
                      disabled ? 'opacity-50 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    <input
                      id={`pm-${opt.providerId}`}
                      type="radio"
                      name="payment-method"
                      className="sr-only"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => select(opt)}
                      aria-describedby={opt.phonePrefix ? `pm-${opt.providerId}-prefix` : undefined}
                    />
                    {opt.logoUrl ? (
                      <img src={opt.logoUrl} alt="" className="w-10 h-10 object-contain" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{opt.displayName}</div>
                      {opt.phonePrefix && (
                        <div id={`pm-${opt.providerId}-prefix`} className="text-xs text-gray-500 dark:text-gray-400">
                          {opt.phonePrefix}
                        </div>
                      )}
                    </div>
                    {selected && (
                      <div aria-hidden="true" className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
