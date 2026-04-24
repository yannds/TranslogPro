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

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.code')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.label')}</th>
              <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.multiplier')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.color')}</th>
              <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.sortOrder')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.fareClasses.status')}</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('common.loading')}</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('tenantSettings.fareClasses.empty')}</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{row.code}</td>
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{row.label}</td>
                <td className="px-3 py-2 text-right text-gray-900 dark:text-gray-100">
                  ×{row.multiplier.toFixed(2)}
                </td>
                <td className="px-3 py-2">
                  {row.color ? (
                    <span className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <span
                        aria-hidden="true"
                        className="inline-block w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="font-mono">{row.color}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-300">{row.sortOrder}</td>
                <td className="px-3 py-2 space-x-1">
                  <Badge variant={row.enabled ? 'success' : 'outline'}>
                    {row.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                  {row.isSystemDefault && (
                    <Badge variant="outline" title={t('tenantSettings.fareClasses.systemBadgeHelp')}>
                      {t('tenantSettings.fareClasses.systemBadge')}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  {canManage ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(row)} aria-label={t('common.edit')}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </Button>
                      {!row.isSystemDefault && (
                        <Button variant="ghost" size="sm" onClick={() => remove(row.id)} aria-label={t('common.delete')}>
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                        </Button>
                      )}
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
