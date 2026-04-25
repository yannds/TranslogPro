/**
 * PageTenantTaxes — CRUD des taxes tenant (TVA, timbre, taxe gare, …).
 *
 * Endpoint : /api/tenants/:tenantId/settings/taxes
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
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

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
  appliedToPrice:          boolean;
  appliedToRecommendation: boolean;
  isSystemDefault:         boolean;
  validFrom?: string | null;
  validTo?:   string | null;
}

const EMPTY: Partial<TenantTax> = {
  code: '', label: '', rate: 0, kind: 'PERCENT', base: 'SUBTOTAL',
  appliesTo: ['ALL'], sortOrder: 0, enabled: true,
  appliedToPrice: true, appliedToRecommendation: true, isSystemDefault: false,
};

const ENTITY_TYPES = ['ALL', 'TICKET', 'PARCEL', 'SUBSCRIPTION', 'INVOICE'];

export function PageTenantTaxes() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canManage = (user?.permissions ?? []).includes('control.tax.manage.tenant');
  const { data, loading, error, refetch } = useFetch<TenantTax[]>(
    tenantId ? `/api/tenants/${tenantId}/settings/taxes` : null,
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
      if (body.id) await apiPatch(`/api/tenants/${tenantId}/settings/taxes/${body.id}`, body);
      else          await apiPost(`/api/tenants/${tenantId}/settings/taxes`, body);
      setEditing(null); refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur');
    } finally { setSubmitting(false); }
  };

  const remove = async (id: string) => {
    if (!confirm(t('tenantSettings.taxes.confirmDelete'))) return;
    await apiDelete(`/api/tenants/${tenantId}/settings/taxes/${id}`);
    refetch();
  };

  const taxColumns: Column<TenantTax>[] = [
    { key: 'code', header: t('tenantSettings.taxes.code'), sortable: true,
      cellRenderer: (v) => <span className="font-mono text-xs">{String(v)}</span> },
    { key: 'label', header: t('tenantSettings.taxes.label'), sortable: true },
    { key: 'rate', header: t('tenantSettings.taxes.rate'), sortable: true, align: 'right',
      cellRenderer: (v, row) => <span>{row.kind === 'PERCENT' ? `${((v as number) * 100).toFixed(2)}%` : (v as number).toFixed(2)}</span> },
    { key: 'base', header: t('tenantSettings.taxes.base'), sortable: true,
      cellRenderer: (v) => <span className="text-gray-600 dark:text-gray-300">{String(v)}</span> },
    { key: 'appliesTo', header: t('tenantSettings.taxes.appliesTo'), sortable: false,
      cellRenderer: (v) => <span className="text-gray-600 dark:text-gray-300">{(v as string[]).join(', ')}</span>,
      csvValue: (v) => (v as string[]).join('|') },
    { key: 'enabled', header: t('tenantSettings.taxes.status'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant={row.enabled ? 'success' : 'outline'}>
            {row.enabled ? t('common.enabled') : t('common.disabled')}
          </Badge>
          {row.isSystemDefault && <Badge variant="outline" title={t('tenantSettings.taxes.systemBadgeHelp')}>{t('tenantSettings.taxes.systemBadge')}</Badge>}
          {!row.appliedToPrice && <Badge variant="outline" title={t('tenantSettings.taxes.notAppliedHelp')}>{t('tenantSettings.taxes.notApplied')}</Badge>}
        </div>
      ) },
  ];

  const taxRowActions: RowAction<TenantTax>[] = [
    { label: t('common.edit'), icon: <Pencil className="w-4 h-4" aria-hidden />, onClick: openEdit },
    { label: t('common.delete'), icon: <Trash2 className="w-4 h-4" aria-hidden />, onClick: (row) => remove(row.id),
      hidden: (row) => row.isSystemDefault, danger: true },
  ];

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

      <DataTableMaster<TenantTax>
        columns={taxColumns}
        data={taxes}
        loading={loading}
        rowActions={canManage ? taxRowActions : undefined}
        onRowClick={canManage ? openEdit : undefined}
        defaultSort={{ key: 'sortOrder', dir: 'asc' }}
        searchPlaceholder={t('tenantSettings.taxes.searchPlaceholder')}
        emptyMessage={t('tenantSettings.taxes.empty')}
        exportFormats={['csv']}
        exportFilename="tenant-taxes"
      />

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
            <fieldset className="lg:col-span-2 border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
              <legend className="text-sm font-medium px-1">{t('tenantSettings.taxes.flagsLegend')}</legend>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={editing.enabled ?? true} onCheckedChange={c => setEditing({ ...editing, enabled: c as boolean })} />
                <span className="flex flex-col">
                  <span className="font-medium">{t('tenantSettings.taxes.enableLabel')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('tenantSettings.taxes.enableHelp')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={editing.appliedToPrice ?? true}
                  onCheckedChange={c => setEditing({ ...editing, appliedToPrice: c as boolean })}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t('tenantSettings.taxes.appliedToPriceLabel')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('tenantSettings.taxes.appliedToPriceHelp')}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={editing.appliedToRecommendation ?? true}
                  onCheckedChange={c => setEditing({ ...editing, appliedToRecommendation: c as boolean })}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t('tenantSettings.taxes.appliedToRecoLabel')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t('tenantSettings.taxes.appliedToRecoHelp')}</span>
                </span>
              </label>
            </fieldset>
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
