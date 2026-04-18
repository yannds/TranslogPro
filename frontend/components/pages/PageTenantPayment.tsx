/**
 * PageTenantPayment — Configuration paiement tenant.
 *
 * Edite TenantPaymentConfig (limites, timings, surcharges…).
 * Les secrets et les toggles LIVE se font dans PageIntegrations.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
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
}

export function PageTenantPayment() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { data, loading, error, refetch } = useFetch<PaymentConfig>(
    tenantId ? `/api/v1/tenants/${tenantId}/settings/payment` : null,
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
      await apiPatch(`/api/v1/tenants/${tenantId}/settings/payment`, form);
      refetch();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSaving(false); }
  };

  if (loading || !form) return <div className="p-6 text-gray-500">{t('common.loading')}</div>;

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('tenantSettings.payment.title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('tenantSettings.payment.subtitle')}</p>
      </header>

      {error && <ErrorAlert error={error} />}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
