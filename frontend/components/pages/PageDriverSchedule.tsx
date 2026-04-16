/**
 * PageDriverSchedule — « Mon planning » (portail chauffeur)
 *
 * Affiche les trajets assignés au chauffeur connecté pour la semaine sélectionnée.
 *
 * API :
 *   GET /api/tenants/:tid/flight-deck/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *       → Trip[] (filtré côté backend par CurrentUser)
 */

import { useMemo, useState } from 'react';
import { CalendarDays, MapPin, Bus } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { Badge }      from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Station {
  id:   string;
  name: string;
}

interface RouteInfo {
  id:               string;
  name:             string;
  originStation?:   Station | null;
  destinationStation?: Station | null;
}

interface BusInfo {
  id:           string;
  plateNumber:  string;
  model?:       string | null;
}

interface ScheduleTrip {
  id:                 string;
  departureScheduled: string;
  arrivalScheduled:   string;
  status:             string;
  route?:             RouteInfo | null;
  bus?:               BusInfo | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'info' | 'warning' | 'success' | 'danger';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  SCHEDULED:   'default',
  BOARDING:    'info',
  IN_PROGRESS: 'warning',
  COMPLETED:   'success',
  CANCELLED:   'danger',
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED:   'driverSchedule.statusScheduled',
  BOARDING:    'driverSchedule.statusBoarding',
  IN_PROGRESS: 'driverSchedule.statusInProgress',
  COMPLETED:   'driverSchedule.statusCompleted',
  CANCELLED:   'driverSchedule.statusCancelled',
};

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function formatHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Sunday of the week containing `d`. */
function sundayOf(d: Date): Date {
  const mon = mondayOf(d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}

function originDest(trip: ScheduleTrip): string {
  const o = trip.route?.originStation?.name ?? '—';
  const d = trip.route?.destinationStation?.name ?? '—';
  return `${o} → ${d}`;
}

function ScheduleStatusCell({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[value] ?? 'default'} size="sm">
      {STATUS_LABEL[value] ? t(STATUS_LABEL[value]) : value}
    </Badge>
  );
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

const columns: Column<ScheduleTrip>[] = [
  {
    key: 'departureScheduled',
    header: 'Date / Heure',
    sortable: true,
    width: '160px',
    cellRenderer: (v) => (
      <div className="tabular-nums">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {formatDateFr(String(v))}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {formatHm(String(v))}
        </p>
      </div>
    ),
    csvValue: (v) => `${formatDateFr(String(v))} ${formatHm(String(v))}`,
  },
  {
    key: 'route',
    header: 'Itinéraire',
    sortable: false,
    cellRenderer: (_v, row) => (
      <div className="flex items-center gap-2 min-w-0">
        <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
        <span className="text-sm text-slate-800 dark:text-slate-200 truncate">
          {row.route?.name ?? '—'}
        </span>
      </div>
    ),
    csvValue: (_v, row) => row.route?.name ?? '',
  },
  {
    key: 'arrivalScheduled',
    header: 'Origine → Destination',
    sortable: false,
    cellRenderer: (_v, row) => (
      <span className="text-sm text-slate-600 dark:text-slate-400 truncate">
        {originDest(row)}
      </span>
    ),
    csvValue: (_v, row) => originDest(row),
  },
  {
    key: 'bus',
    header: 'Véhicule',
    sortable: false,
    width: '130px',
    cellRenderer: (_v, row) => (
      <div className="flex items-center gap-1.5">
        <Bus className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
        <span className="text-sm font-mono text-slate-600 dark:text-slate-400">
          {row.bus?.plateNumber ?? '—'}
        </span>
      </div>
    ),
    csvValue: (_v, row) => row.bus?.plateNumber ?? '',
  },
  {
    key: 'status',
    header: 'Statut',
    sortable: true,
    width: '130px',
    cellRenderer: (v) => <ScheduleStatusCell value={String(v)} />,
    csvValue: (v) => String(v),
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageDriverSchedule() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const now = new Date();
  const [from, setFrom] = useState(formatYmd(mondayOf(now)));
  const [to, setTo]     = useState(formatYmd(sundayOf(now)));

  const url = useMemo(() => {
    if (!tenantId || !from || !to) return null;
    return `/api/tenants/${tenantId}/flight-deck/schedule?from=${from}&to=${to}`;
  }, [tenantId, from, to]);

  const { data, loading, error } = useFetch<ScheduleTrip[]>(url, [url]);
  const trips = data ?? [];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Mon planning">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <CalendarDays className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverSchedule.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverSchedule.pageSubtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      {/* Week selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('driverSchedule.from')}</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={inputClass}
          aria-label="Date de début"
        />
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('driverSchedule.to')}</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={inputClass}
          aria-label="Date de fin"
        />
      </div>

      {/* Table */}
      <DataTableMaster<ScheduleTrip>
        columns={columns}
        data={trips}
        loading={loading}
        defaultSort={{ key: 'departureScheduled', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('driverSchedule.searchPh')}
        emptyMessage={t('driverSchedule.emptyMsg')}
        exportFormats={['csv', 'json']}
        exportFilename="mon-planning"
        stickyHeader
      />
    </main>
  );
}
