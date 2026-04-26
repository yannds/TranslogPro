/**
 * PageTenantPayment — Configuration paiement tenant.
 *
 * Sections :
 *   1. Compte de retrait (où arrive l'argent du transporteur après chaque ticket)
 *   2. Aperçu commission plateforme (lecture seule, vient de PlatformPaymentConfig
 *      + éventuel override négocié)
 *   3. Paramètres avancés (timings, refund threshold…)
 *
 * Les secrets et les toggles LIVE se font dans PageIntegrations.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Save, Wallet, Info, Settings2 } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Checkbox } from '../ui/Checkbox';
import { ErrorAlert } from '../ui/ErrorAlert';

interface PaymentConfig {
  intentTtlMinutes:          number;
  momoPushTimeoutSeconds:    number;
  webhookRetryMaxAttempts:   number;
  reconciliationLagMinutes:  number;
  allowGuestCheckout:        boolean;
  passProviderFeesToCustomer: boolean;
  refundMfaThreshold:        number;
  allowedCurrencies:         string[];
  // Compte de retrait
  payoutMethod:              string;          // MOBILE_MONEY | SUBACCOUNT | BANK
  payoutPhoneE164:           string | null;
  payoutSubaccountId:        string | null;
  payoutAccountName:         string | null;
  // Override commission (lecture seule côté tenant — édité par SA seulement)
  platformFeeBpsOverride:    number | null;
}

interface PlatformPaymentSnapshot {
  platformFeeBps:       number;
  platformFeePolicy:    string;
  platformFeeFlatMinor: number;
}

const PAYOUT_METHODS = ['MOBILE_MONEY', 'SUBACCOUNT', 'BANK'] as const;
type PayoutMethod = typeof PAYOUT_METHODS[number];

export function PageTenantPayment() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { data, loading, error, refetch } = useFetch<PaymentConfig>(
    tenantId ? `/api/tenants/${tenantId}/settings/payment` : null,
  );
  // La config plateforme est exposée publiquement en lecture seule pour
  // que le tenant voie le taux qui lui est appliqué.
  const { data: platformSnap } = useFetch<PlatformPaymentSnapshot>(
    '/api/public/platform-fee',
  );
  const [form, setForm] = useState<PaymentConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true); setSaveError(null);
    try {
      await apiPatch(`/api/tenants/${tenantId}/settings/payment`, form);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  if (loading || !form) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;

  // Calcul du taux effectif (override > défaut plateforme)
  const effectiveBps = form.platformFeeBpsOverride ?? platformSnap?.platformFeeBps ?? 300;
  const effectivePct = (effectiveBps / 100).toFixed(2);
  const tenantPct    = (100 - effectiveBps / 100).toFixed(2);

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('tenantSettings.payment.title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('tenantSettings.payment.subtitle')}</p>
      </header>

      {error && <ErrorAlert error={error} />}

      {/* ── Section 1 : Compte de retrait ─────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('tenantSettings.payment.payoutSection')}
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('tenantSettings.payment.payoutDescription')}
        </p>

        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.payoutMethod')}</span>
          <select
            value={form.payoutMethod}
            onChange={e => setForm({ ...form, payoutMethod: e.target.value as PayoutMethod })}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            aria-label={t('tenantSettings.payment.payoutMethod')}
          >
            <option value="MOBILE_MONEY">{t('tenantSettings.payment.payoutMobileMoney')}</option>
            <option value="SUBACCOUNT">{t('tenantSettings.payment.payoutSubaccount')}</option>
            <option value="BANK">{t('tenantSettings.payment.payoutBank')}</option>
          </select>
        </label>

        {form.payoutMethod === 'MOBILE_MONEY' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1">
              {t('tenantSettings.payment.payoutPhone')}
            </span>
            <Input
              type="tel"
              placeholder="+242066000000"
              value={form.payoutPhoneE164 ?? ''}
              onChange={e => setForm({ ...form, payoutPhoneE164: e.target.value || null })}
            />
            <span className="block text-xs text-gray-500 mt-1">
              {t('tenantSettings.payment.payoutPhoneHelp')}
            </span>
          </label>
        )}

        {form.payoutMethod === 'SUBACCOUNT' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1">
              {t('tenantSettings.payment.payoutSubaccountId')}
            </span>
            <Input
              type="text"
              placeholder="RS_XXXXXXXXXXXX"
              value={form.payoutSubaccountId ?? ''}
              onChange={e => setForm({ ...form, payoutSubaccountId: e.target.value || null })}
            />
            <span className="block text-xs text-gray-500 mt-1">
              {t('tenantSettings.payment.payoutSubaccountIdHelp')}
            </span>
          </label>
        )}

        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.payoutAccountName')}</span>
          <Input
            type="text"
            value={form.payoutAccountName ?? ''}
            onChange={e => setForm({ ...form, payoutAccountName: e.target.value || null })}
          />
        </label>
      </section>

      {/* ── Section 2 : Aperçu commission plateforme ─────────────────────── */}
      <section className="rounded-lg border border-teal-200 dark:border-teal-900 bg-teal-50/40 dark:bg-teal-950/20 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Info className="w-5 h-5 text-teal-700 dark:text-teal-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('tenantSettings.payment.feeSection')}
          </h2>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('tenantSettings.payment.feeBreakdown')
            .replace('{tenantPct}', tenantPct)
            .replace('{platformPct}', effectivePct)}
        </p>
        {form.platformFeeBpsOverride != null && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('tenantSettings.payment.feeOverrideActive')}
          </p>
        )}
      </section>

      {/* ── Section 3 : Paramètres avancés ────────────────────────────────── */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-gray-600 dark:text-gray-400" aria-hidden />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('tenantSettings.payment.advancedSection')}
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.intentTtl')}</span>
            <Input type="number" min="1" value={form.intentTtlMinutes}
              onChange={e => setForm({ ...form, intentTtlMinutes: parseInt(e.target.value, 10) })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.momoPushTimeout')}</span>
            <Input type="number" min="10" value={form.momoPushTimeoutSeconds}
              onChange={e => setForm({ ...form, momoPushTimeoutSeconds: parseInt(e.target.value, 10) })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.webhookRetryMax')}</span>
            <Input type="number" min="0" value={form.webhookRetryMaxAttempts}
              onChange={e => setForm({ ...form, webhookRetryMaxAttempts: parseInt(e.target.value, 10) })} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.reconciliationLag')}</span>
            <Input type="number" min="1" value={form.reconciliationLagMinutes}
              onChange={e => setForm({ ...form, reconciliationLagMinutes: parseInt(e.target.value, 10) })} />
          </label>
          <label className="block lg:col-span-2">
            <span className="block text-sm font-medium mb-1">{t('tenantSettings.payment.refundMfaThreshold')}</span>
            <Input type="number" min="0" value={form.refundMfaThreshold}
              onChange={e => setForm({ ...form, refundMfaThreshold: parseFloat(e.target.value) })} />
          </label>
          <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
            <Checkbox checked={form.allowGuestCheckout} onCheckedChange={c => setForm({ ...form, allowGuestCheckout: c as boolean })} />
            <span>{t('tenantSettings.payment.allowGuestCheckout')}</span>
          </label>
          <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
            <Checkbox checked={form.passProviderFeesToCustomer}
              onCheckedChange={c => setForm({ ...form, passProviderFeesToCustomer: c as boolean })} />
            <span>{t('tenantSettings.payment.passFees')}</span>
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
