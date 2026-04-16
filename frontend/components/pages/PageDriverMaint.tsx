/**
 * PageDriverMaint — « Signaler une panne »
 *
 * Page chauffeur : liste de ses signalements de panne/maintenance + création.
 * Utilise DataTableMaster (composant projet obligatoire) pour la liste.
 *
 * API :
 *   GET  /api/tenants/:tid/fleet/buses       → liste des bus (pour le select)
 *   GET  /api/tenants/:tid/garage/reports     → mes signalements (scope own)
 *   POST /api/tenants/:tid/garage/reports     → créer un signalement
 */

import { useState, type FormEvent } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                        from '../../lib/i18n/useI18n';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost }                       from '../../lib/api';
import { Badge }                         from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';
import DataTableMaster, { type Column }  from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusLite { id: string; plateNumber: string; model?: string | null; }

interface ReportRow {
  id:          string;
  busId:       string;
  type:        string;
  description: string;
  status:      string;
  createdAt:   string;
  bus?:        { plateNumber: string };
}

const MAINT_TYPES = ['BREAKDOWN', 'FLAT_TIRE', 'ENGINE', 'ELECTRICAL', 'OTHER'] as const;

// ─── i18n ────────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  BREAKDOWN:  'driverMaint.typeBreakdown',
  FLAT_TIRE:  'driverMaint.typeFlatTire',
  ENGINE:     'driverMaint.typeEngine',
  ELECTRICAL: 'driverMaint.typeElectrical',
  OTHER:      'driverMaint.typeOther',
};

const STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'default'> = {
  SCHEDULED: 'info',
  COMPLETED: 'warning',
  APPROVED:  'success',
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'driverMaint.statusScheduled',
  COMPLETED: 'driverMaint.statusCompleted',
  APPROVED:  'driverMaint.statusApproved',
};

interface FormValues {
  busId:       string;
  type:        string;
  description: string;
  odometer:    string;
  scheduledAt: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const EMPTY_FORM: FormValues = {
  busId: '', type: 'BREAKDOWN', description: '', odometer: '', scheduledAt: nowLocal(),
};

// ─── Columns ──────────────────────────────────────────────────────────────────

function TypeLabel({ value }: { value: string }) {
  const { t } = useI18n();
  return <Badge size="sm" variant="outline">{TYPE_LABELS[value] ? t(TYPE_LABELS[value]) : value}</Badge>;
}

function StatusLabel({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Badge size="sm" variant={STATUS_VARIANT[value] ?? 'default'}>
      {STATUS_LABEL[value] ? t(STATUS_LABEL[value]) : value}
    </Badge>
  );
}

const columns: Column<ReportRow>[] = [
  {
    key: 'busId',
    header: 'Véhicule',
    sortable: true,
    cellRenderer: (_v, row) => (
      <span className="font-semibold text-slate-900 dark:text-slate-100">
        {row.bus?.plateNumber ?? row.busId.slice(0, 8)}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    sortable: true,
    cellRenderer: (v) => <TypeLabel value={v as string} />,
  },
  {
    key: 'description',
    header: 'Description',
    cellRenderer: (v) => (
      <span className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1">{v as string}</span>
    ),
  },
  {
    key: 'status',
    header: 'Statut',
    sortable: true,
    cellRenderer: (v) => <StatusLabel value={v as string} />,
  },
  {
    key: 'createdAt',
    header: 'Date',
    sortable: true,
    cellRenderer: (v) => (
      <span className="text-xs tabular-nums text-slate-500">
        {new Date(v as string).toLocaleString('fr-FR')}
      </span>
    ),
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageDriverMaint() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const { data: reports, loading, error, refetch } = useFetch<ReportRow[]>(
    tenantId ? `${base}/garage/reports` : null, [tenantId],
  );
  const { data: buses } = useFetch<BusLite[]>(
    tenantId ? `${base}/fleet/buses` : null, [tenantId],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm]             = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy]             = useState(false);
  const [actionErr, setActionErr]   = useState<string | null>(null);

  const patch = (p: Partial<FormValues>) => setForm(prev => ({ ...prev, ...p }));

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, scheduledAt: nowLocal() });
    setActionErr(null);
    setShowCreate(true);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await apiPost(`${base}/garage/reports`, {
        busId:       form.busId,
        type:        form.type,
        description: form.description.trim(),
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        odometer:    form.odometer ? Number(form.odometer) : undefined,
      });
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Signaler une panne">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverMaint.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('driverMaint.pageSubtitle')}
            </p>
          </div>
        </div>
        <Button onClick={openCreate} disabled={!tenantId}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('driverMaint.report')}
        </Button>
      </div>

      <ErrorAlert error={error} icon />

      {/* Table */}
      <DataTableMaster<ReportRow>
        columns={columns}
        data={reports ?? []}
        loading={loading}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        searchPlaceholder={t('driverMaint.searchPlaceholder')}
        emptyMessage={t('driverMaint.emptyMessage')}
        exportFormats={['csv']}
        exportFilename="mes-signalements-pannes"
      />

      {/* Create dialog */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) setShowCreate(false); }}
        title={t('driverMaint.newReport')}
        description={t('driverMaint.newReportDesc')}
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverMaint.vehicle')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.busId}
                onChange={e => patch({ busId: e.target.value })}
                className={inp}
                disabled={busy}
              >
                <option value="">{t('driverMaint.selectPlaceholder')}</option>
                {(buses ?? []).map(b => (
                  <option key={b.id} value={b.id}>
                    {b.plateNumber}{b.model ? ` — ${b.model}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverMaint.breakdownType')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <select
                required
                value={form.type}
                onChange={e => patch({ type: e.target.value })}
                className={inp}
                disabled={busy}
              >
                {MAINT_TYPES.map(mtype => (
                  <option key={mtype} value={mtype}>{t(TYPE_LABELS[mtype])}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverMaint.descriptionLabel')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={e => patch({ description: e.target.value })}
              className={inp}
              disabled={busy}
              placeholder={t('driverMaint.descPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverMaint.mileage')}
              </label>
              <input
                type="number"
                min={0}
                value={form.odometer}
                onChange={e => patch({ odometer: e.target.value })}
                className={inp}
                disabled={busy}
                placeholder="124540"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverMaint.dateLabel')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={form.scheduledAt}
                onChange={e => patch({ scheduledAt: e.target.value })}
                className={inp}
                disabled={busy}
              />
            </div>
          </div>

          <FormFooter
            onCancel={() => setShowCreate(false)}
            busy={busy}
            submitLabel={t('driverMaint.sendReport')}
            pendingLabel={t('driverMaint.sending')}
          />
        </form>
      </Dialog>
    </main>
  );
}
