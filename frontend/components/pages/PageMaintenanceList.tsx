/**
 * PageMaintenanceList — « Fiches de maintenance »
 *
 * Liste + création + complétion + approbation des rapports garage.
 * PRD §IV.4 — workflow SCHEDULED → COMPLETED → APPROVED (→ Bus.AVAILABLE).
 *
 * API :
 *   GET   /api/tenants/:tid/garage/reports?status=…
 *   POST  /api/tenants/:tid/garage/reports          body: CreateMaintenanceDto
 *   PATCH /api/tenants/:tid/garage/reports/:id/complete   body: { notes }
 *   PATCH /api/tenants/:tid/garage/reports/:id/approve
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Wrench, Plus, Check, ShieldCheck, ClipboardCheck, Bus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch }             from '../../lib/api';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Skeleton }                      from '../ui/Skeleton';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportStatus = 'SCHEDULED' | 'COMPLETED' | 'APPROVED';

interface ReportRow {
  id:           string;
  busId:        string;
  type:         string;
  description:  string;
  scheduledAt:  string;
  completedAt?: string | null;
  approvedAt?:  string | null;
  odometer?:    number | null;
  status:       ReportStatus;
  notes?:       string | null;
  bus?:         { plateNumber: string; model?: string | null };
}

interface BusLite { id: string; plateNumber: string; model?: string | null; }

const TYPES = [
  'PREVENTIVE',  // entretien périodique
  'CURATIVE',    // panne
  'REVISION',    // vidange etc.
  'PNEUS',       // pneumatiques
  'CARROSSERIE', // carrosserie
  'AUTRE',
];

interface FormValues {
  busId:       string;
  type:        string;
  description: string;
  scheduledAt: string;
  odometer:    string;
}

const EMPTY_FORM: FormValues = {
  busId: '', type: 'PREVENTIVE', description: '', scheduledAt: '', odometer: '',
};

const STATUS_VARIANT: Record<ReportStatus, 'info' | 'warning' | 'success'> = {
  SCHEDULED: 'info',
  COMPLETED: 'warning',
  APPROVED:  'success',
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  SCHEDULED: 'maintenanceList.plannedAt',
  COMPLETED: 'maintenanceList.completed',
  APPROVED:  'maintenanceList.validated',
};

// ─── Formulaire ───────────────────────────────────────────────────────────────

function ReportForm({
  buses, initial, onSubmit, onCancel, busy, error,
}: {
  buses:    BusLite[];
  initial:  FormValues;
  onSubmit: (v: FormValues) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<FormValues>(initial);
  const patch = (p: Partial<FormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
      className="space-y-4"
    >
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('maintenanceList.vehicle')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.busId}
            onChange={e => patch({ busId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('maintenanceList.selectOption')}</option>
            {buses.map(b => (
              <option key={b.id} value={b.id}>
                {b.plateNumber}{b.model ? ` — ${b.model}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.type')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.type}
            onChange={e => patch({ type: e.target.value })}
            className={inp} disabled={busy}>
            {TYPES.map(ty => <option key={ty} value={ty}>{ty}</option>)}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.description')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <textarea required rows={3} value={f.description}
          onChange={e => patch({ description: e.target.value })}
          className={inp} disabled={busy}
          placeholder={t('maintenanceList.descPlaceholder')} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('maintenanceList.plannedDate')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="datetime-local" required value={f.scheduledAt}
            onChange={e => patch({ scheduledAt: e.target.value })}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('maintenanceList.odometer')}
          </label>
          <input type="number" min={0} value={f.odometer}
            onChange={e => patch({ odometer: e.target.value })}
            className={inp} disabled={busy} placeholder="124540" />
        </div>
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={t('maintenanceList.createSheet')} pendingLabel={t('maintenanceList.creating')} />
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageMaintenanceList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/garage`;

  const [filter, setFilter] = useState<ReportStatus | 'ALL'>('ALL');

  const url = useMemo(() => {
    if (!tenantId) return null;
    return filter === 'ALL'
      ? `${base}/reports`
      : `${base}/reports?status=${filter}`;
  }, [tenantId, base, filter]);

  const { data: reports, loading, error, refetch } = useFetch<ReportRow[]>(url, [url]);
  const { data: buses } = useFetch<BusLite[]>(
    tenantId ? `/api/tenants/${tenantId}/fleet/buses` : null, [tenantId],
  );

  const [showCreate,   setShowCreate]   = useState(false);
  const [completeOf,   setCompleteOf]   = useState<ReportRow | null>(null);
  const [completeNotes,setCompleteNotes]= useState('');
  const [approveOf,    setApproveOf]    = useState<ReportRow | null>(null);
  const [busy,         setBusy]         = useState(false);
  const [actionErr,    setActionErr]    = useState<string | null>(null);

  const kpi = useMemo(() => {
    const list = reports ?? [];
    return {
      total:     list.length,
      scheduled: list.filter(r => r.status === 'SCHEDULED').length,
      completed: list.filter(r => r.status === 'COMPLETED').length,
      approved:  list.filter(r => r.status === 'APPROVED').length,
    };
  }, [reports]);

  const handleCreate = async (f: FormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/reports`, {
        busId:       f.busId,
        type:        f.type,
        description: f.description.trim(),
        scheduledAt: new Date(f.scheduledAt).toISOString(),
        odometer:    f.odometer ? Number(f.odometer) : undefined,
      });
      setShowCreate(false); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleComplete = async () => {
    if (!completeOf) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/reports/${completeOf.id}/complete`, { notes: completeNotes });
      setCompleteOf(null); setCompleteNotes(''); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleApprove = async () => {
    if (!approveOf) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/reports/${approveOf.id}/approve`, {});
      setApproveOf(null); refetch();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const sorted = useMemo(
    () => [...(reports ?? [])].sort((a, b) =>
      new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
    ),
    [reports],
  );

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('maintenanceList.pageTitle')}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <Wrench className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('maintenanceList.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('maintenanceList.pageDesc')}
            </p>
          </div>
        </div>
        <Button onClick={() => { setActionErr(null); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('maintenanceList.newSheet')}
        </Button>
      </div>

      <ErrorAlert error={error || actionErr} icon />

      <section aria-label={t('maintenanceList.pageTitle')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={t('maintenanceList.total')}     value={kpi.total}     icon={<ClipboardCheck className="w-5 h-5" />} />
        <Kpi label={t('maintenanceList.planned')}   value={kpi.scheduled} icon={<Wrench className="w-5 h-5" />} tone="info" />
        <Kpi label={t('maintenanceList.completed')} value={kpi.completed} icon={<Check className="w-5 h-5" />} tone="warning" />
        <Kpi label={t('maintenanceList.validated')} value={kpi.approved}  icon={<ShieldCheck className="w-5 h-5" />} tone="success" />
      </section>

      <div className="flex items-center gap-2">
        {(['ALL','SCHEDULED','COMPLETED','APPROVED'] as const).map(f => (
          <button key={f} type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
              ${filter === f
                ? 'bg-teal-600 text-white border-teal-600'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50'}`}>
            {f === 'ALL' ? t('maintenanceList.all') : t(STATUS_LABEL[f])}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          heading={`${sorted.length} ${t('maintenanceList.sheets')}`}
          description={t('maintenanceList.sortedDesc')}
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <Wrench className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('maintenanceList.noSheet')}</p>
              <p className="text-sm mt-1">{t('maintenanceList.createSheetHint')}</p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
              {sorted.map(r => (
                <li key={r.id} className="px-6 py-4 flex items-start gap-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0">
                    <Bus className="w-4 h-4 text-slate-500" aria-hidden />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {r.bus?.plateNumber ?? r.busId.slice(0, 8)}
                      </span>
                      <Badge size="sm" variant="outline">{r.type}</Badge>
                      <Badge size="sm" variant={STATUS_VARIANT[r.status]}>{t(STATUS_LABEL[r.status])}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                      {r.description}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                      {t('maintenanceList.plannedAt')} : {new Date(r.scheduledAt).toLocaleString('fr-FR')}
                      {r.odometer != null && ` · ${r.odometer.toLocaleString('fr-FR')} km`}
                    </p>
                    {r.notes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                        {t('maintenanceList.notes')} : {r.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.status === 'SCHEDULED' && (
                      <Button variant="outline" size="sm"
                        onClick={() => { setActionErr(null); setCompleteNotes(''); setCompleteOf(r); }}>
                        <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden />
                        {t('maintenanceList.finish')}
                      </Button>
                    )}
                    {r.status === 'COMPLETED' && (
                      <Button size="sm"
                        onClick={() => { setActionErr(null); setApproveOf(r); }}>
                        <ShieldCheck className="w-3.5 h-3.5 mr-1.5" aria-hidden />
                        {t('maintenanceList.validate')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('maintenanceList.newMainSheet')}
        description={t('maintenanceList.planVehicle')}
        size="lg"
      >
        <ReportForm
          buses={buses ?? []}
          initial={EMPTY_FORM}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Compléter */}
      <Dialog
        open={!!completeOf}
        onOpenChange={o => { if (!o) { setCompleteOf(null); setCompleteNotes(''); } }}
        title={t('maintenanceList.finishTitle')}
        description={completeOf?.description}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setCompleteOf(null)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={handleComplete} disabled={busy}>
              <Check className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('maintenanceList.saving') : t('maintenanceList.markDone')}
            </Button>
          </div>
        }
      >
        <ErrorAlert error={actionErr} />
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          {t('maintenanceList.interventionNotes')}
        </label>
        <textarea rows={4} value={completeNotes}
          onChange={e => setCompleteNotes(e.target.value)}
          className={inp}
          placeholder={t('maintenanceList.notesPlaceholder')} />
      </Dialog>

      {/* Approuver */}
      <Dialog
        open={!!approveOf}
        onOpenChange={o => { if (!o) setApproveOf(null); }}
        title={t('maintenanceList.validateTitle')}
        description={
          approveOf
            ? `${t('maintenanceList.vehicle')} ${approveOf.bus?.plateNumber ?? ''} — ${t('maintenanceList.validateDesc')}`
            : undefined
        }
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setApproveOf(null)} disabled={busy}>{t('common.cancel')}</Button>
            <Button onClick={handleApprove} disabled={busy}>
              <ShieldCheck className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('maintenanceList.validating') : t('maintenanceList.validate')}
            </Button>
          </div>
        }
      >
        <ErrorAlert error={actionErr} />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('maintenanceList.validateWarning')}
        </p>
      </Dialog>
    </main>
  );
}

function Kpi({
  label, value, icon, tone = 'default',
}: {
  label: string; value: number; icon: React.ReactNode;
  tone?: 'default' | 'info' | 'warning' | 'success';
}) {
  const toneClass = {
    default: 'bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400',
    info:    'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
    success: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
  }[tone];
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}`}
    >
      <div className={`p-2.5 rounded-lg shrink-0 ${toneClass}`} aria-hidden>{icon}</div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
      </div>
    </article>
  );
}
