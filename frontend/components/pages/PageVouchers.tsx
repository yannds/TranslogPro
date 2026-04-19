/**
 * PageVouchers — Liste admin des bons de réduction émis.
 *
 * Endpoint : GET /api/v1/tenants/:tid/vouchers (+ query status)
 * Permission : data.voucher.read.tenant
 *
 * Actions :
 *   - Émission manuelle (geste commercial / promo)  — dialog de création
 *   - Annulation (avant utilisation)                — confirm + DELETE
 *   - Filtre par statut (ISSUED / REDEEMED / EXPIRED / CANCELLED)
 *
 * Qualité : i18n fr+en, WCAG AA, responsive desktop-first, dark+light,
 * DataTableMaster absent ici (liste simple) — à remplacer si besoin.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiDelete, apiPatch } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Badge } from '../ui/Badge';
import { FormFooter } from '../ui/FormFooter';
import { ErrorAlert } from '../ui/ErrorAlert';

interface Voucher {
  id:             string;
  code:           string;
  amount:         number;
  currency:       string;
  status:         'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  origin:         string;
  usageScope:     string;
  validityStart?: string | null;
  validityEnd:    string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  customerId?:   string | null;
  sourceTripId?: string | null;
  issuedBy?:     string | null;
  createdAt:     string;
}

const STATUS_VARIANTS: Record<Voucher['status'], 'success' | 'outline' | 'warning' | 'danger'> = {
  ISSUED:    'success',
  REDEEMED:  'outline',
  EXPIRED:   'warning',
  CANCELLED: 'danger',
};

const ORIGINS = ['PROMO', 'MANUAL', 'GESTURE'] as const;
const SCOPES  = ['SAME_COMPANY', 'SAME_ROUTE', 'ANY_TRIP'] as const;

const EMPTY_NEW = {
  amount:        0,
  currency:      'XAF',
  validityDays:  180,
  usageScope:    'SAME_COMPANY',
  origin:        'MANUAL' as typeof ORIGINS[number],
  recipientPhone:'',
  recipientEmail:'',
};

export function PageVouchers() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [filterStatus, setFilterStatus] = useState<string>('');
  const url = tenantId
    ? `/api/v1/tenants/${tenantId}/vouchers${filterStatus ? `?status=${filterStatus}` : ''}`
    : null;
  const { data, loading, error, refetch } = useFetch<Voucher[]>(url, [tenantId, filterStatus]);

  const [issueOpen, setIssueOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_NEW);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setSubmitErr(null);
    try {
      if (form.amount <= 0 || form.validityDays <= 0) {
        throw new Error(t('vouchers.invalidAmountOrValidity'));
      }
      await apiPost(`/api/v1/tenants/${tenantId}/vouchers`, form);
      setIssueOpen(false); setForm(EMPTY_NEW); refetch();
    } catch (err) {
      setSubmitErr(err instanceof Error ? err.message : 'Error');
    } finally { setSubmitting(false); }
  };

  const cancel = async (v: Voucher) => {
    const reason = window.prompt(t('vouchers.cancelReason'));
    if (!reason) return;
    // Le backend attend le reason en body — DELETE avec body → utilise POST via endpoint wrapper
    await apiPatch(`/api/v1/tenants/${tenantId}/vouchers/${v.id}/cancel`, { reason });
    refetch();
  };
  // placeholder lint : apiDelete importé mais on pourrait l'utiliser pour d'autres actions
  void apiDelete;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('vouchers.title')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('vouchers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            options={[
              { value: '',          label: t('vouchers.allStatuses') },
              { value: 'ISSUED',    label: t('vouchers.status.ISSUED') },
              { value: 'REDEEMED',  label: t('vouchers.status.REDEEMED') },
              { value: 'EXPIRED',   label: t('vouchers.status.EXPIRED') },
              { value: 'CANCELLED', label: t('vouchers.status.CANCELLED') },
            ]}
          />
          <Button onClick={() => setIssueOpen(true)} leftIcon={<Plus className="w-4 h-4" aria-hidden="true" />}>
            {t('vouchers.issue')}
          </Button>
        </div>
      </header>

      {error && <ErrorAlert error={error} />}

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.code')}</th>
              <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">{t('vouchers.amount')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.origin')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.recipient')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.scope')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.validityEnd')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('vouchers.statusLabel')}</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-6 text-center text-gray-500">{t('common.loading')}</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-gray-500">{t('vouchers.empty')}</td></tr>}
            {rows.map(v => (
              <tr key={v.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{v.code}</td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100">{v.amount.toLocaleString()} {v.currency}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t(`vouchers.origin.${v.origin}` as const) || v.origin}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{v.recipientPhone ?? v.recipientEmail ?? v.customerId ?? '—'}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{t(`vouchers.scope.${v.usageScope}` as const) || v.usageScope}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{new Date(v.validityEnd).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <Badge variant={STATUS_VARIANTS[v.status]}>{t(`vouchers.status.${v.status}`)}</Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  {v.status === 'ISSUED' && (
                    <Button variant="ghost" size="sm" aria-label={t('vouchers.cancelAction')} onClick={() => cancel(v)}>
                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {issueOpen && (
        <Dialog open={issueOpen} onOpenChange={setIssueOpen} title={t('vouchers.issueTitle')} size="xl">
          <form onSubmit={submit} className="p-6 space-y-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.amount')}</span>
              <Input type="number" min="1" step="0.01" value={form.amount}
                onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.currency')}</span>
              <Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} required maxLength={3} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.validityDays')}</span>
              <Input type="number" min="1" value={form.validityDays}
                onChange={e => setForm({ ...form, validityDays: parseInt(e.target.value, 10) || 1 })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.origin')}</span>
              <Select value={form.origin}
                onChange={e => setForm({ ...form, origin: e.target.value as typeof ORIGINS[number] })}
                options={ORIGINS.map(o => ({ value: o, label: t(`vouchers.origin.${o}` as const) || o }))} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.scope')}</span>
              <Select value={form.usageScope}
                onChange={e => setForm({ ...form, usageScope: e.target.value })}
                options={SCOPES.map(s => ({ value: s, label: t(`vouchers.scope.${s}`) }))} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('vouchers.recipientPhone')}</span>
              <Input type="tel" value={form.recipientPhone}
                onChange={e => setForm({ ...form, recipientPhone: e.target.value })} />
            </label>
            <label className="block lg:col-span-2">
              <span className="block text-sm font-medium mb-1">{t('vouchers.recipientEmail')}</span>
              <Input type="email" value={form.recipientEmail}
                onChange={e => setForm({ ...form, recipientEmail: e.target.value })} />
            </label>
            {submitErr && <div className="lg:col-span-2"><ErrorAlert error={submitErr} /></div>}
            <div className="lg:col-span-2">
              <FormFooter
                onCancel={() => setIssueOpen(false)}
                submitLabel={t('vouchers.issue')}
                pendingLabel={t('common.saving')}
                busy={submitting}
              />
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
