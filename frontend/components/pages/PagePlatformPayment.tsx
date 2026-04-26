/**
 * PagePlatformPayment — Configuration paiement plateforme (super-admin).
 *
 * Sections :
 *   1. Commission SaaS par défaut (basis points + policy + flat)
 *   2. Compte de retrait commission (où arrive votre part de chaque transaction)
 *   3. Paramètres globaux (grace period PAST_DUE, retries webhook…)
 *
 * Permission requise côté backend : PLATFORM_BILLING_MANAGE_GLOBAL.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Save, Coins, Wallet, Settings2, Info } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { ErrorAlert } from '../ui/ErrorAlert';

interface PlatformPaymentConfig {
  pastDueGraceHours:             number;
  globalWebhookRetryMax:         number;
  webhookRetryInitialBackoffSec: number;
  reconciliationCronEnabled:     boolean;
  reconciliationLagMinutes:      number;
  alertEmailOnGhostPayment:      string | null;
  // Commission plateforme
  platformFeeBps:                number;
  platformFeePolicy:             string;
  platformFeeFlatMinor:          number;
  // Compte de retrait
  platformPayoutMethod:          string;
  platformPayoutPhoneE164:       string | null;
  platformPayoutSubaccountId:    string | null;
  platformPayoutAccountName:     string | null;
}

export function PagePlatformPayment() {
  const { t } = useI18n();
  const { data, loading, error, refetch } = useFetch<PlatformPaymentConfig>(
    '/api/platform/payment/config',
  );
  const [form, setForm] = useState<PlatformPaymentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true); setSaveError(null);
    try {
      await apiPatch('/api/platform/payment/config', form);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  if (loading || !form) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;

  const pct = (form.platformFeeBps / 100).toFixed(2);

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {t('platformPayment.title')}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('platformPayment.subtitle')}
        </p>
      </header>

      {error && <ErrorAlert error={error} />}

      {/* ── Section 1 : Commission SaaS ───────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('platformPayment.feeSection')}
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('platformPayment.feeDescription')}
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.feePolicy')}</span>
            <select
              value={form.platformFeePolicy}
              onChange={e => setForm({ ...form, platformFeePolicy: e.target.value })}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              aria-label={t('platformPayment.feePolicy')}
            >
              <option value="PERCENT">{t('platformPayment.feePolicyPercent')}</option>
              <option value="FLAT">{t('platformPayment.feePolicyFlat')}</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-sm font-medium mb-1">
              {t('platformPayment.feeBps')} <span className="text-gray-500 text-xs">({pct} %)</span>
            </span>
            <Input
              type="number"
              min="0"
              max="10000"
              step="1"
              value={form.platformFeeBps}
              onChange={e => setForm({ ...form, platformFeeBps: parseInt(e.target.value, 10) || 0 })}
            />
            <span className="block text-xs text-gray-500 mt-1">{t('platformPayment.feeBpsHelp')}</span>
          </label>

          <label className="block lg:col-span-2">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.feeFlat')}</span>
            <Input
              type="number"
              min="0"
              step="1"
              value={form.platformFeeFlatMinor}
              onChange={e => setForm({ ...form, platformFeeFlatMinor: parseInt(e.target.value, 10) || 0 })}
            />
            <span className="block text-xs text-gray-500 mt-1">{t('platformPayment.feeFlatHelp')}</span>
          </label>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3">
          <Info className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <p className="text-xs text-amber-900 dark:text-amber-200">
            {t('platformPayment.feeWarning')}
          </p>
        </div>
      </section>

      {/* ── Section 2 : Compte de retrait commission ──────────────────────── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('platformPayment.payoutSection')}
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('platformPayment.payoutDescription')}
        </p>

        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('platformPayment.payoutMethod')}</span>
          <select
            value={form.platformPayoutMethod}
            onChange={e => setForm({ ...form, platformPayoutMethod: e.target.value })}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            aria-label={t('platformPayment.payoutMethod')}
          >
            <option value="AGGREGATOR_MAIN">{t('platformPayment.payoutAggregatorMain')}</option>
            <option value="MOBILE_MONEY">{t('platformPayment.payoutMobileMoney')}</option>
            <option value="SUBACCOUNT">{t('platformPayment.payoutSubaccount')}</option>
            <option value="BANK">{t('platformPayment.payoutBank')}</option>
          </select>
        </label>

        {form.platformPayoutMethod === 'MOBILE_MONEY' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.payoutPhone')}</span>
            <Input
              type="tel"
              placeholder="+242066000000"
              value={form.platformPayoutPhoneE164 ?? ''}
              onChange={e => setForm({ ...form, platformPayoutPhoneE164: e.target.value || null })}
            />
          </label>
        )}

        {form.platformPayoutMethod === 'SUBACCOUNT' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.payoutSubaccountId')}</span>
            <Input
              type="text"
              placeholder="RS_XXXXXXXXXXXX"
              value={form.platformPayoutSubaccountId ?? ''}
              onChange={e => setForm({ ...form, platformPayoutSubaccountId: e.target.value || null })}
            />
          </label>
        )}

        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('platformPayment.payoutAccountName')}</span>
          <Input
            type="text"
            value={form.platformPayoutAccountName ?? ''}
            onChange={e => setForm({ ...form, platformPayoutAccountName: e.target.value || null })}
          />
        </label>
      </section>

      {/* ── Section 3 : Paramètres globaux ────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-gray-600 dark:text-gray-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('platformPayment.globalsSection')}
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.pastDueGraceHours')}</span>
            <Input type="number" min="0" value={form.pastDueGraceHours}
              onChange={e => setForm({ ...form, pastDueGraceHours: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.webhookRetryMax')}</span>
            <Input type="number" min="0" value={form.globalWebhookRetryMax}
              onChange={e => setForm({ ...form, globalWebhookRetryMax: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.webhookBackoff')}</span>
            <Input type="number" min="1" value={form.webhookRetryInitialBackoffSec}
              onChange={e => setForm({ ...form, webhookRetryInitialBackoffSec: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.reconciliationLag')}</span>
            <Input type="number" min="1" value={form.reconciliationLagMinutes}
              onChange={e => setForm({ ...form, reconciliationLagMinutes: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
            <Checkbox checked={form.reconciliationCronEnabled}
              onCheckedChange={c => setForm({ ...form, reconciliationCronEnabled: c as boolean })} />
            <span>{t('platformPayment.reconciliationCronEnabled')}</span>
          </label>
          <label className="block lg:col-span-2">
            <span className="block text-sm font-medium mb-1">{t('platformPayment.alertEmail')}</span>
            <Input
              type="email"
              value={form.alertEmailOnGhostPayment ?? ''}
              onChange={e => setForm({ ...form, alertEmailOnGhostPayment: e.target.value || null })}
            />
          </label>
        </div>
      </section>

      {saveError && <ErrorAlert error={saveError} />}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Button type="submit" loading={saving} leftIcon={<Save className="w-4 h-4" aria-hidden />}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
