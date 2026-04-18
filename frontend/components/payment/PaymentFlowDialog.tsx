/**
 * PaymentFlowDialog — modale orchestrant tout le parcours d'achat.
 *
 * Phases :
 *   1. SELECT_METHOD   → utilise PaymentMethodPicker
 *   2. DETAILS         → champs contextuels (phone pour MoMo, iframe hosted pour CARD)
 *   3. PROCESSING      → spinner + status polling
 *   4. SUCCESS / ERROR
 *
 * Desktop-first : max-w-4xl, lg: deux colonnes récap + form.
 * Dark/Light + i18n (préfixe 'payment.*').
 */
import { useMemo, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ErrorAlert } from '../ui/ErrorAlert';
import { useI18n } from '../../lib/i18n/useI18n';
import { PaymentMethodPicker, type PaymentMethodOption } from './PaymentMethodPicker';
import { usePaymentIntent, type CreateIntentInput, type CreateIntentResult } from './usePaymentIntent';

type Phase = 'SELECT_METHOD' | 'DETAILS' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

interface Props {
  open:       boolean;
  onClose:    () => void;
  tenantId:   string;
  methods:    PaymentMethodOption[];
  intent:     Omit<CreateIntentInput, 'method' | 'customerPhone'> & { currency: string };
  summary:    { label: string; value: string }[];
  onSuccess?: (res: CreateIntentResult) => void;
}

export function PaymentFlowDialog({ open, onClose, tenantId, methods, intent, summary, onSuccess }: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('SELECT_METHOD');
  const [picked, setPicked] = useState<PaymentMethodOption | null>(null);
  const [phone, setPhone] = useState('');
  const paymentHook = usePaymentIntent(tenantId);

  const canSubmit = useMemo(() => {
    if (!picked) return false;
    if (picked.type === 'MOBILE_MONEY' && !/^\+?\d{7,}$/.test(phone.replace(/\s/g, ''))) return false;
    return true;
  }, [picked, phone]);

  const submit = async () => {
    if (!picked) return;
    setPhase('PROCESSING');
    const res = await paymentHook.createIntent({
      ...intent,
      method:        picked.type,
      customerPhone: picked.type === 'MOBILE_MONEY' ? phone : undefined,
    });
    if (!res) { setPhase('ERROR'); return; }
    if (res.paymentUrl) window.open(res.paymentUrl, '_blank', 'noopener,noreferrer');
    if (onSuccess) onSuccess(res);
  };

  const close = () => { paymentHook.stopPolling(); setPhase('SELECT_METHOD'); setPicked(null); setPhone(''); onClose(); };

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) close(); }}
      title={t('payment.title')}
      size="2xl"
    >
      <div className="p-6 lg:p-8 grid lg:grid-cols-[1fr_320px] gap-6 lg:gap-10">
        {/* Main column */}
        <div className="space-y-6">
          <header className="flex items-center justify-between">
            <span className="sr-only">{t('payment.title')}</span>
            {phase === 'DETAILS' && (
              <Button variant="ghost" size="sm" onClick={() => setPhase('SELECT_METHOD')}>
                <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t('payment.back')}
              </Button>
            )}
          </header>

          {phase === 'SELECT_METHOD' && (
            <>
              <PaymentMethodPicker
                options={methods}
                value={picked?.providerId}
                onChange={opt => { setPicked(opt); setPhase(opt.type === 'MOBILE_MONEY' ? 'DETAILS' : 'DETAILS'); }}
              />
              {paymentHook.error && <ErrorAlert error={paymentHook.error} />}
            </>
          )}

          {phase === 'DETAILS' && picked && (
            <div className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                {t('payment.provider')}: <span className="font-medium">{picked.displayName}</span>
              </div>
              {picked.type === 'MOBILE_MONEY' && (
                <label className="block">
                  <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('payment.phone')}</span>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder={picked.phonePrefix ? `${picked.phonePrefix} 06 XX XX XX XX` : ''}
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    aria-required="true"
                  />
                </label>
              )}
              <Button onClick={submit} disabled={!canSubmit || paymentHook.loading} className="w-full">
                {paymentHook.loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                {t('payment.confirmPay')}
              </Button>
            </div>
          )}

          {phase === 'PROCESSING' && (
            <div role="status" aria-live="polite" className="py-12 flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" aria-hidden="true" />
              <div className="text-sm text-gray-700 dark:text-gray-200 text-center">
                {t('payment.processing')} — {paymentHook.status || 'PENDING'}
              </div>
            </div>
          )}

          {phase === 'SUCCESS' && (
            <div role="status" className="py-12 flex flex-col items-center gap-3">
              <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" aria-hidden="true" />
              <div className="text-base font-medium">{t('payment.success')}</div>
            </div>
          )}

          {phase === 'ERROR' && (
            <div role="alert" className="py-12 flex flex-col items-center gap-3">
              <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400" aria-hidden="true" />
              <div className="text-base font-medium">{t('payment.error')}</div>
              <Button variant="ghost" onClick={() => setPhase('SELECT_METHOD')}>{t('payment.retry')}</Button>
            </div>
          )}
        </div>

        {/* Summary sidebar */}
        <aside className="lg:border-l lg:pl-6 lg:border-gray-200 lg:dark:border-gray-700">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">
            {t('payment.summary')}
          </h3>
          <dl className="space-y-2 text-sm">
            {summary.map(item => (
              <div key={item.label} className="flex justify-between">
                <dt className="text-gray-600 dark:text-gray-400">{item.label}</dt>
                <dd className="font-medium text-gray-900 dark:text-gray-100">{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </Dialog>
  );
}
