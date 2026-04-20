/**
 * PageTenantTaxes — CRUD des taxes tenant (TVA, timbre, taxe gare, …).
 *
 * Endpoint : /api/v1/tenants/:tenantId/settings/taxes
 * Permissions :
 *   - data.tax.read.tenant     : lecture (tous rôles avec accès, ex. caissier)
 *   - control.tax.manage.tenant: écriture (création/édition/suppression)
 *
 * WCAG AA + dark/light + i18n (clés `tenantSettings.taxes.*`).
 * Desktop-first : DataTableMaster + modale d'édition riche.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Checkbox } from '../ui/Checkbox';
import { Badge } from '../ui/Badge';
import { FormFooter } from '../ui/FormFooter';
import { ErrorAlert } from '../ui/ErrorAlert';

interface TenantTax {
  id:        string;
  code:      string;
  label:     string;
  labelKey?: string | null;
  rate:      number;
  kind:      'PERCENT' | 'FIXED';
  base:      'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS';
  appliesTo: string[];
  sortOrder: number;
  enabled:   boolean;
  validFrom?: string | null;
  validTo?:   string | null;
}

const EMPTY: Partial<TenantTax> = {
  code: '', label: '', rate: 0, kind: 'PERCENT', base: 'SUBTOTAL',
  appliesTo: ['ALL'], sortOrder: 0, enabled: true,
};

const ENTITY_TYPES = ['ALL', 'TICKET', 'PARCEL', 'SUBSCRIPTION', 'INVOICE'];

export function PageTenantTaxes() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canManage = (user?.permissions ?? []).includes('control.tax.manage.tenant');
  const { data, loading, error, refetch } = useFetch<TenantTax[]>(
    tenantId ? `/api/v1/tenants/${tenantId}/settings/taxes` : null,
  );

  const [editing, setEditing] = useState<Partial<TenantTax> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const taxes = useMemo(() => data ?? [], [data]);

  const openNew  = () => { setEditing({ ...EMPTY }); setSubmitError(null); };
  const openEdit = (t: TenantTax) => { setEditing({ ...t }); setSubmitError(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const body = { ...editing };
      if (body.id) await apiPatch(`/api/v1/tenants/${tenantId}/settings/taxes/${body.id}`, body);
      else          await apiPost(`/api/v1/tenants/${tenantId}/settings/taxes`, body);
      setEditing(null); refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!confirm(t('tenantSettings.taxes.confirmDelete'))) return;
    await apiDelete(`/api/v1/tenants/${tenantId}/settings/taxes/${id}`);
    refetch();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('tenantSettings.taxes.title')}</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {canManage ? t('tenantSettings.taxes.subtitle') : t('tenantSettings.taxes.subtitleReadOnly')}
          </p>
        </div>
        {canManage && (
          <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" aria-hidden="true" />}>
            {t('tenantSettings.taxes.add')}
          </Button>
        )}
      </header>

      {error && <ErrorAlert error={error} />}

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.code')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.label')}</th>
              <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.rate')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.base')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.appliesTo')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.taxes.status')}</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('common.loading')}</td></tr>
            )}
            {!loading && taxes.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('tenantSettings.taxes.empty')}</td></tr>
            )}
            {taxes.map(row => (
              <tr key={row.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{row.code}</td>
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.label}</td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100">
                  {row.kind === 'PERCENT' ? `${(row.rate * 100).toFixed(2)}%` : row.rate.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.base}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{row.appliesTo.join(', ')}</td>
                <td className="px-3 py-2">
                  <Badge variant={row.enabled ? 'success' : 'outline'}>
                    {row.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  {canManage ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(row)} aria-label={t('common.edit')}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(row.id)} aria-label={t('common.delete')}>
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{t('common.readOnly')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Dialog
          open={!!editing}
          onOpenChange={o => { if (!o) setEditing(null); }}
          title={editing.id ? t('tenantSettings.taxes.edit') : t('tenantSettings.taxes.add')}
          size="xl"
        >
          <form onSubmit={submit} className="p-6 space-y-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.code')}</span>
              <Input value={editing.code ?? ''} onChange={e => setEditing({ ...editing, code: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.label')}</span>
              <Input value={editing.label ?? ''} onChange={e => setEditing({ ...editing, label: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.kind')}</span>
              <Select
                value={editing.kind ?? 'PERCENT'}
                onChange={e => setEditing({ ...editing, kind: e.target.value as 'PERCENT' | 'FIXED' })}
                options={[
                  { value: 'PERCENT', label: t('tenantSettings.taxes.percent') },
                  { value: 'FIXED',   label: t('tenantSettings.taxes.fixed')   },
                ]}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.rate')}</span>
              <Input type="number" step="0.0001" min="0" value={editing.rate ?? 0} onChange={e => setEditing({ ...editing, rate: parseFloat(e.target.value) })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.base')}</span>
              <Select
                value={editing.base ?? 'SUBTOTAL'}
                onChange={e => setEditing({ ...editing, base: e.target.value as 'SUBTOTAL' | 'TOTAL_AFTER_PREVIOUS' })}
                options={[
                  { value: 'SUBTOTAL',             label: t('tenantSettings.taxes.baseSubtotal') },
                  { value: 'TOTAL_AFTER_PREVIOUS', label: t('tenantSettings.taxes.baseCascade')  },
                ]}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.taxes.sortOrder')}</span>
              <Input type="number" value={editing.sortOrder ?? 0} onChange={e => setEditing({ ...editing, sortOrder: parseInt(e.target.value, 10) })} />
            </label>
            <fieldset className="lg:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3">
              <legend className="text-sm font-medium px-1">{t('tenantSettings.taxes.appliesTo')}</legend>
              <div className="flex flex-wrap gap-3 mt-2">
                {ENTITY_TYPES.map(ent => (
                  <label key={ent} className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editing.appliesTo?.includes(ent) ?? false}
                      onCheckedChange={checked => {
                        const set = new Set(editing.appliesTo ?? []);
                        if (checked) set.add(ent); else set.delete(ent);
                        setEditing({ ...editing, appliesTo: Array.from(set) });
                      }}
                    />
                    <span>{ent}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
              <Checkbox checked={editing.enabled ?? true} onCheckedChange={c => setEditing({ ...editing, enabled: c as boolean })} />
              <span>{t('tenantSettings.taxes.enableLabel')}</span>
            </label>
            {submitError && <div className="lg:col-span-2"><ErrorAlert error={submitError} /></div>}
            <div className="lg:col-span-2">
              <FormFooter
                onCancel={() => setEditing(null)}
                submitLabel={t('common.save')}
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
