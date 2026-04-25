/**
 * PageTenantFareClasses — CRUD des classes de voyage tenant.
 *
 * Endpoint : /api/tenants/:tenantId/settings/fare-classes
 * Permissions :
 *   - data.fareClass.read.tenant     : lecture (caissier, agent, comptable)
 *   - control.fareClass.manage.tenant: écriture (TENANT_ADMIN seul)
 *
 * WCAG AA + dark/light + i18n (clés `tenantSettings.fareClasses.*`).
 * Desktop-first : DataTableMaster + modale d'édition.
 * Les classes isSystemDefault sont modifiables (multiplier/label/ordre/couleur)
 * mais non supprimables — protection contre la perte des classes historiques.
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
import { Checkbox } from '../ui/Checkbox';
import { Badge } from '../ui/Badge';
import { FormFooter } from '../ui/FormFooter';
import { ErrorAlert } from '../ui/ErrorAlert';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

interface TenantFareClass {
  id:              string;
  code:            string;
  label:           string;
  labelKey?:       string | null;
  multiplier:      number;
  sortOrder:       number;
  color?:          string | null;
  enabled:         boolean;
  isSystemDefault: boolean;
}

const EMPTY: Partial<TenantFareClass> = {
  code: '', label: '', multiplier: 1.0, sortOrder: 0, enabled: true, isSystemDefault: false,
};

export function PageTenantFareClasses() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId  = user?.tenantId ?? '';
  const canManage = (user?.permissions ?? []).includes('control.fareClass.manage.tenant');

  const { data, loading, error, refetch } = useFetch<TenantFareClass[]>(
    tenantId ? `/api/tenants/${tenantId}/settings/fare-classes` : null,
  );

  const [editing, setEditing] = useState<Partial<TenantFareClass> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  const openNew  = () => { setEditing({ ...EMPTY }); setSubmitError(null); };
  const openEdit = (row: TenantFareClass) => { setEditing({ ...row }); setSubmitError(null); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const body = { ...editing };
      if (body.id) {
        await apiPatch(`/api/tenants/${tenantId}/settings/fare-classes/${body.id}`, body);
      } else {
        await apiPost(`/api/tenants/${tenantId}/settings/fare-classes`, body);
      }
      setEditing(null); refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t('tenantSettings.fareClasses.confirmDelete'))) return;
    try {
      await apiDelete(`/api/tenants/${tenantId}/settings/fare-classes/${id}`);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const fareColumns: Column<TenantFareClass>[] = [
    { key: 'code', header: t('tenantSettings.fareClasses.code'), sortable: true,
      cellRenderer: (v) => <span className="font-mono text-xs">{String(v)}</span> },
    { key: 'label', header: t('tenantSettings.fareClasses.label'), sortable: true },
    { key: 'multiplier', header: t('tenantSettings.fareClasses.multiplier'), sortable: true, align: 'right',
      cellRenderer: (v) => <span>×{(v as number).toFixed(2)}</span> },
    { key: 'color', header: t('tenantSettings.fareClasses.color'), sortable: false,
      cellRenderer: (v) => v ? (
        <span className="inline-flex items-center gap-2 text-xs">
          <span aria-hidden className="inline-block w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600" style={{ backgroundColor: v as string }} />
          <span className="font-mono">{v as string}</span>
        </span>
      ) : <span className="text-xs text-gray-400">—</span> },
    { key: 'sortOrder', header: t('tenantSettings.fareClasses.sortOrder'), sortable: true, align: 'right' },
    { key: 'enabled', header: t('tenantSettings.fareClasses.status'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant={row.enabled ? 'success' : 'outline'}>
            {row.enabled ? t('common.enabled') : t('common.disabled')}
          </Badge>
          {row.isSystemDefault && <Badge variant="outline" title={t('tenantSettings.fareClasses.systemBadgeHelp')}>{t('tenantSettings.fareClasses.systemBadge')}</Badge>}
        </div>
      ) },
  ];

  const fareRowActions: RowAction<TenantFareClass>[] = [
    { label: t('common.edit'), icon: <Pencil className="w-4 h-4" aria-hidden />, onClick: openEdit },
    { label: t('common.delete'), icon: <Trash2 className="w-4 h-4" aria-hidden />, onClick: (row) => remove(row.id),
      hidden: (row) => row.isSystemDefault, danger: true },
  ];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {t('tenantSettings.fareClasses.title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {canManage ? t('tenantSettings.fareClasses.subtitle') : t('tenantSettings.fareClasses.subtitleReadOnly')}
          </p>
        </div>
        {canManage && (
          <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" aria-hidden="true" />}>
            {t('tenantSettings.fareClasses.add')}
          </Button>
        )}
      </header>

      {error && <ErrorAlert error={error} />}

      <DataTableMaster<TenantFareClass>
        columns={fareColumns}
        data={rows}
        loading={loading}
        rowActions={canManage ? fareRowActions : undefined}
        onRowClick={canManage ? openEdit : undefined}
        defaultSort={{ key: 'sortOrder', dir: 'asc' }}
        searchPlaceholder={t('tenantSettings.fareClasses.searchPlaceholder')}
        emptyMessage={t('tenantSettings.fareClasses.empty')}
        exportFormats={['csv']}
        exportFilename="fare-classes"
      />

      {editing && (
        <Dialog
          open={!!editing}
          onOpenChange={o => { if (!o) setEditing(null); }}
          title={editing.id ? t('tenantSettings.fareClasses.edit') : t('tenantSettings.fareClasses.add')}
          size="lg"
        >
          <form onSubmit={submit} className="p-6 space-y-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.fareClasses.code')}</span>
              <Input
                value={editing.code ?? ''}
                onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                required
                disabled={editing.isSystemDefault === true}
              />
              {editing.isSystemDefault && (
                <span className="block text-xs text-gray-500 mt-1">{t('tenantSettings.fareClasses.codeLockedHelp')}</span>
              )}
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.fareClasses.label')}</span>
              <Input value={editing.label ?? ''} onChange={e => setEditing({ ...editing, label: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.fareClasses.multiplier')}</span>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={editing.multiplier ?? 1}
                onChange={e => setEditing({ ...editing, multiplier: parseFloat(e.target.value) })}
                required
              />
              <span className="block text-xs text-gray-500 mt-1">{t('tenantSettings.fareClasses.multiplierHelp')}</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.fareClasses.sortOrder')}</span>
              <Input
                type="number"
                value={editing.sortOrder ?? 0}
                onChange={e => setEditing({ ...editing, sortOrder: parseInt(e.target.value, 10) })}
              />
            </label>
            <label className="block lg:col-span-2">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.fareClasses.color')}</span>
              <Input
                type="text"
                placeholder="#6b7280"
                value={editing.color ?? ''}
                onChange={e => setEditing({ ...editing, color: e.target.value || null })}
              />
              <span className="block text-xs text-gray-500 mt-1">{t('tenantSettings.fareClasses.colorHelp')}</span>
            </label>
            <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
              <Checkbox checked={editing.enabled ?? true} onCheckedChange={c => setEditing({ ...editing, enabled: c as boolean })} />
              <span>{t('tenantSettings.fareClasses.enableLabel')}</span>
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
