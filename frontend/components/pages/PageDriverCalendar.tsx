/**
 * PageDriverCalendar — Calendrier d'un chauffeur (admin / dispatcher / superviseur)
 *
 * Accès : rôles ayant `TRIP_READ_TENANT` (admin tenant, dispatcher, superviseur,
 * manager agence). Permet de voir les trajets assignés à un chauffeur donné
 * sur une fenêtre temporelle (semaine par défaut).
 *
 * API :
 *   GET /api/tenants/:tid/staff?role=DRIVER
 *   GET /api/tenants/:tid/trips?driverId=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Click sur une ligne → TripQuickInfoDialog (bus, route, shipments, colis).
 */

import { useMemo, useState, useEffect } from 'react';
import { CalendarDays, User2 } from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }         from '../ui/Badge';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { inputClass }    from '../ui/inputClass';
import DataTableMaster, { type Column } from '../DataTableMaster';
import { TripQuickInfoDialog }                   from './trips/TripQuickInfoDialog';
import {
  type TripRow, tripStatusBadgeVariant, tripStatusLabel,
  routeLabelOf, startOfWeek, addDays, formatYmd, formatHm,
} from './trips/shared';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StaffRow {
  id:           string;
  userId:       string;
  user:         { id: string; email: string; name?: string | null };
  assignments?: Array<{ role: string; isAvailable: boolean; status: string }>;
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDriverCalendar() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  // ── Liste des chauffeurs ─────────────────────────────────────────────────
  const { data: drivers, loading: driversLoading, error: driversError } =
    useFetch<StaffRow[]>(tenantId ? `${base}/staff?role=DRIVER` : null, [tenantId]);

  // ── Sélection chauffeur + fenêtre ────────────────────────────────────────
  const [driverId, setDriverId] = useState<string | null>(null);

  const today = new Date();
  const [from, setFrom] = useState<string>(formatYmd(startOfWeek(today)));
  const [to,   setTo]   = useState<string>(formatYmd(addDays(startOfWeek(today), 6)));

  useEffect(() => {
    if (drivers && drivers.length > 0 && !driverId) {
      setDriverId(drivers[0].id);
    }
  }, [drivers, driverId]);

  // ── Fetch trips pour le chauffeur sélectionné sur la fenêtre ──────────────
  // Les dates sont élargies à des bornes ISO jour-plein (00:00 → 23:59:59)
  // pour que le filtre backend (departureScheduled between) couvre bien la
  // journée entière.
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso   = `${to}T23:59:59.999Z`;

  const tripsUrl = tenantId && driverId
    ? `${base}/trips?driverId=${driverId}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`
    : null;

  const { data: trips, loading: tripsLoading, error: tripsError } =
    useFetch<TripRow[]>(tripsUrl, [tripsUrl]);

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // ── Stats rapides ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const list = trips ?? [];
    const delayed   = list.filter(tr => tr.status === 'IN_PROGRESS_DELAYED').length;
    const completed = list.filter(tr => tr.status === 'COMPLETED').length;
    const upcoming  = list.filter(tr => ['PLANNED', 'OPEN', 'BOARDING'].includes(tr.status)).length;
    return { total: list.length, delayed, completed, upcoming };
  }, [trips]);

  // ── Colonnes table ───────────────────────────────────────────────────────
  const columns: Column<TripRow>[] = useMemo(() => [
    {
      key: 'departureScheduled',
      header: t('driverCalendar.colDate'),
      sortable: true,
      cellRenderer: (v) => {
        const d = new Date(v as string);
        return (
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">{formatHm(d)}</p>
          </div>
        );
      },
    },
    {
      key: 'route' as keyof TripRow,
      header: t('driverCalendar.colRoute'),
      cellRenderer: (_v, row) => (
        <span className="text-sm text-slate-700 dark:text-slate-200">{routeLabelOf(row)}</span>
      ),
    },
    {
      key: 'bus' as keyof TripRow,
      header: t('driverCalendar.colVehicle'),
      cellRenderer: (_v, row) => (
        <span className="text-sm tabular-nums">{row.bus?.plateNumber ?? '—'}</span>
      ),
    },
    {
      key: 'status',
      header: t('driverCalendar.colStatus'),
      sortable: true,
      cellRenderer: (v) => (
        <Badge variant={tripStatusBadgeVariant(v as string)} size="sm">
          {tripStatusLabel(v as string)}
        </Badge>
      ),
    },
  ], [t]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const selectedDriver = drivers?.find(d => d.id === driverId);
  const driverLabel = (d: StaffRow) => d.user?.name || d.user?.email || d.id.slice(0, 8);

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('driverCalendar.pageTitle')}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <CalendarDays className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverCalendar.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverCalendar.pageSubtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={driversError || tripsError} icon />

      {/* Filtres */}
      <Card>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div className="space-y-1.5">
              <label htmlFor="driver-select" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverCalendar.driver')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <select
                  id="driver-select"
                  value={driverId ?? ''}
                  onChange={e => setDriverId(e.target.value || null)}
                  disabled={driversLoading || !drivers || drivers.length === 0}
                  className={`${inputClass} pl-9`}
                >
                  {drivers?.length === 0 && (
                    <option value="">{t('driverCalendar.noDriver')}</option>
                  )}
                  {(drivers ?? []).map(d => (
                    <option key={d.id} value={d.id}>{driverLabel(d)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="from-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverCalendar.from')}
              </label>
              <input id="from-date" type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="to-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverCalendar.to')}
              </label>
              <input id="to-date" type="date" value={to} onChange={e => setTo(e.target.value)} className={inputClass} />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  const s = startOfWeek(new Date());
                  setFrom(formatYmd(s));
                  setTo(formatYmd(addDays(s, 6)));
                }}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {t('driverCalendar.thisWeek')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const s = new Date(now.getFullYear(), now.getMonth(), 1);
                  const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                  setFrom(formatYmd(s));
                  setTo(formatYmd(e));
                }}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                {t('driverCalendar.thisMonth')}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {driverId && (
        <section aria-label={t('driverCalendar.stats')} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiLite label={t('driverCalendar.kpiTotal')}     value={stats.total} />
          <KpiLite label={t('driverCalendar.kpiUpcoming')}  value={stats.upcoming} />
          <KpiLite label={t('driverCalendar.kpiCompleted')} value={stats.completed} />
          <KpiLite label={t('driverCalendar.kpiDelayed')}   value={stats.delayed} danger />
        </section>
      )}

      {/* Table */}
      <Card>
        <CardHeader
          heading={selectedDriver ? `${t('driverCalendar.schedule')} — ${driverLabel(selectedDriver)}` : t('driverCalendar.schedule')}
          description={`${from} → ${to}`}
        />
        <CardContent className="p-0">
          {!driverId ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('driverCalendar.selectDriver')}
            </div>
          ) : (
            <DataTableMaster<TripRow>
              columns={columns}
              data={trips ?? []}
              loading={tripsLoading}
              defaultSort={{ key: 'departureScheduled', dir: 'asc' }}
              defaultPageSize={25}
              searchPlaceholder={t('driverCalendar.searchPh')}
              emptyMessage={t('driverCalendar.emptyMsg')}
              onRowClick={(row) => setSelectedTripId(row.id)}
              exportFormats={['csv', 'json']}
              exportFilename={selectedDriver ? `planning-${driverLabel(selectedDriver).toLowerCase().replace(/\s+/g, '-')}` : 'planning-chauffeur'}
              stickyHeader
            />
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      {selectedTripId && (
        <TripQuickInfoDialog
          tripId={selectedTripId}
          tenantId={tenantId}
          onClose={() => setSelectedTripId(null)}
        />
      )}
    </main>
  );
}

function KpiLite({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${danger && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'}`}>
        {value}
      </p>
    </article>
  );
}

export default PageDriverCalendar;
