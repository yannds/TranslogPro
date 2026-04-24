/**
 * PageTenantPeakPeriods — CRUD des périodes peak (calendrier yield, Sprint 5).
 *
 * Pilote la 5ème règle du YieldService (priorité max : événement calendrier >
 * réaction fillRate). Permet d'ajuster les tarifs automatiquement en haute
 * saison / creux.
 *
 * Endpoint : /api/tenants/:tid/peak-periods
 * Permissions : data.peakPeriod.read.tenant / control.peakPeriod.manage.tenant
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Pencil, Trash2, Calendar } from 'lucide-react';
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

interface PeakPeriod {
  id:                   string;
  code:                 string;
  label:                string;
  labelKey?:            string | null;
  countryCode?:         string | null;
  startDate:            string;
  endDate:              string;
  expectedDemandFactor: number;
  isHoliday:            boolean;
  isSystemDefault:      boolean;
  enabled:              boolean;
}

const EMPTY: Partial<PeakPeriod> = {
  code: '', label: '', startDate: '', endDate: '',
  expectedDemandFactor: 1.2, isHoliday: false, enabled: true,
};

function toInputDate(iso: string): string {
  if (!iso) return '';
  return iso.substring(0, 10);
}

export function PageTenantPeakPeriods() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canManage = (user?.permissions ?? []).includes('control.peakPeriod.manage.tenant');

  const { data, loading, error, refetch } = useFetch<PeakPeriod[]>(
    tenantId ? `/api/tenants/${tenantId}/peak-periods` : null,
  );

  const [editing, setEditing] = useState<Partial<PeakPeriod> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  const openNew  = () => { setEditing({ ...EMPTY }); setSubmitError(null); };
  const openEdit = (p: PeakPeriod) => {
    setEditing({
      ...p,
      startDate: toInputDate(p.startDate),
      endDate:   toInputDate(p.endDate),
    });
    setSubmitError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const body = { ...editing };
      if (body.id) {
        await apiPatch(`/api/tenants/${tenantId}/peak-periods/${body.id}`, body);
      } else {
        await apiPost(`/api/tenants/${tenantId}/peak-periods`, body);
      }
      setEditing(null); refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (p: PeakPeriod) => {
    if (!confirm(t('tenantSettings.peakPeriods.confirmDelete'))) return;
    try {
      await apiDelete(`/api/tenants/${tenantId}/peak-periods/${p.id}`);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erreur');
    }
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });

  const factorBadge = (f: number) => {
    if (f > 1.05)  return <Badge variant="success">×{f.toFixed(2)}</Badge>;
    if (f < 0.95)  return <Badge variant="warning">×{f.toFixed(2)}</Badge>;
    return <Badge variant="outline">×{f.toFixed(2)}</Badge>;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Calendar className="w-6 h-6" aria-hidden />
            {t('tenantSettings.peakPeriods.title')}
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {canManage ? t('tenantSettings.peakPeriods.subtitle') : t('tenantSettings.peakPeriods.subtitleReadOnly')}
          </p>
        </div>
        {canManage && (
          <Button onClick={openNew} leftIcon={<Plus className="w-4 h-4" aria-hidden />}>
            {t('tenantSettings.peakPeriods.add')}
          </Button>
        )}
      </header>

      {error && <ErrorAlert error={error} />}

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.code')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.label')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.dates')}</th>
              <th className="px-3 py-2 text-right font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.factor')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.country')}</th>
              <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">{t('tenantSettings.peakPeriods.status')}</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('common.loading')}</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t('tenantSettings.peakPeriods.empty')}</td></tr>
            )}
            {rows.map(p => (
              <tr key={p.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2 font-mono text-xs text-gray-900 dark:text-gray-100">{p.code}</td>
                <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                  {p.label}
                  {p.isHoliday && <Badge variant="outline" className="ml-2">{t('tenantSettings.peakPeriods.holiday')}</Badge>}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {fmtDate(p.startDate)} → {fmtDate(p.endDate)}
                </td>
                <td className="px-3 py-2 text-right">{factorBadge(p.expectedDemandFactor)}</td>
                <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{p.countryCode ?? '—'}</td>
                <td className="px-3 py-2 space-x-1">
                  <Badge variant={p.enabled ? 'success' : 'outline'}>
                    {p.enabled ? t('common.enabled') : t('common.disabled')}
                  </Badge>
                  {p.isSystemDefault && (
                    <Badge variant="outline" title={t('tenantSettings.peakPeriods.systemBadgeHelp')}>
                      {t('tenantSettings.peakPeriods.systemBadge')}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  {canManage ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)} aria-label={t('common.edit')}>
                        <Pencil className="w-4 h-4" aria-hidden />
                      </Button>
                      {!p.isSystemDefault && (
                        <Button variant="ghost" size="sm" onClick={() => remove(p)} aria-label={t('common.delete')}>
                          <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden />
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-gray-400">{t('common.readOnly')}</span>
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
          title={editing.id ? t('tenantSettings.peakPeriods.edit') : t('tenantSettings.peakPeriods.add')}
          size="lg"
        >
          <form onSubmit={submit} className="p-6 space-y-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.code')}</span>
              <Input
                value={editing.code ?? ''}
                onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                required disabled={editing.isSystemDefault === true}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.label')}</span>
              <Input value={editing.label ?? ''} onChange={e => setEditing({ ...editing, label: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.startDate')}</span>
              <Input type="date" value={editing.startDate ?? ''} onChange={e => setEditing({ ...editing, startDate: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.endDate')}</span>
              <Input type="date" value={editing.endDate ?? ''} onChange={e => setEditing({ ...editing, endDate: e.target.value })} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.factor')}</span>
              <Input
                type="number" step="0.01" min="0.1" max="5"
                value={editing.expectedDemandFactor ?? 1}
                onChange={e => setEditing({ ...editing, expectedDemandFactor: parseFloat(e.target.value) })}
                required
              />
              <span className="block text-xs text-gray-500 mt-1">{t('tenantSettings.peakPeriods.factorHelp')}</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1">{t('tenantSettings.peakPeriods.country')}</span>
              <Input
                placeholder="CG, SN, CI…"
                value={editing.countryCode ?? ''}
                onChange={e => setEditing({ ...editing, countryCode: e.target.value.toUpperCase() || null })}
              />
            </label>
            <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
              <Checkbox checked={editing.isHoliday ?? false} onCheckedChange={c => setEditing({ ...editing, isHoliday: c as boolean })} />
              <span>{t('tenantSettings.peakPeriods.isHoliday')}</span>
            </label>
            <label className="lg:col-span-2 inline-flex items-center gap-2 text-sm">
              <Checkbox checked={editing.enabled ?? true} onCheckedChange={c => setEditing({ ...editing, enabled: c as boolean })} />
              <span>{t('tenantSettings.peakPeriods.enableLabel')}</span>
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
