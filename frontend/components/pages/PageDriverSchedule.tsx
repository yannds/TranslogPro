/**
 * PageDriverSchedule — « Mon planning » (portail chauffeur)
 *
 * Affiche les trajets assignés au chauffeur connecté pour la semaine sélectionnée.
 * Clic sur un trajet → panneau détail complet avec waypoints, passagers, checklist,
 * statut briefing et actions contextuelles.
 *
 * API :
 *   GET /api/tenants/:tid/flight-deck/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /api/tenants/:tid/flight-deck/trips/:tripId/detail
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, MapPin, Bus, Clock, Users,
  ClipboardCheck, Eye, ChevronRight, CheckCircle2, Circle,
  AlertTriangle,
} from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { Badge }      from '../ui/Badge';
import { Button }     from '../ui/Button';
import { Dialog }     from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton }   from '../ui/Skeleton';
import { inputClass } from '../ui/inputClass';
import { cn }         from '../../lib/utils';
import DataTableMaster, { type Column } from '../DataTableMaster';
import { TripWorkflowActions } from '../driver/TripWorkflowActions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StationLite {
  id:   string;
  name: string;
  city?: string;
}

interface WaypointInfo {
  id:                  string;
  order:               number;
  distanceFromOriginKm: number;
  isMandatoryStop:     boolean;
  isAlertZone:         boolean;
  alertDescription?:   string | null;
  estimatedWaitTime?:  number | null;
  station:             StationLite;
}

interface RouteInfo {
  id:               string;
  name:             string;
  distanceKm?:      number;
  origin?:          StationLite | null;
  destination?:     StationLite | null;
  waypoints?:       WaypointInfo[];
}

interface BusInfo {
  id:           string;
  plateNumber:  string;
  model?:       string | null;
}

interface ChecklistItem {
  id:          string;
  label?:      string | null;
  isCompliant: boolean;
}

interface ScheduleTrip {
  id:                 string;
  departureScheduled: string;
  arrivalScheduled:   string;
  status:             string;
  route?:             RouteInfo | null;
  bus?:               BusInfo | null;
  _count?: {
    travelers:  number;
    checklists: number;
  };
}

interface TripDetail extends ScheduleTrip {
  checklists:  ChecklistItem[];
  briefing:    { briefedAt: string | null; crewRole: string } | null;
  _count:      { travelers: number; checklists: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'info' | 'warning' | 'success' | 'danger';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PLANNED:     'default',
  SCHEDULED:   'default',
  OPEN:        'info',
  BOARDING:    'info',
  IN_PROGRESS: 'warning',
  IN_PROGRESS_PAUSED:  'warning',
  IN_PROGRESS_DELAYED: 'danger',
  COMPLETED:   'success',
  CANCELLED:   'danger',
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED:     'driverSchedule.statusScheduled',
  SCHEDULED:   'driverSchedule.statusScheduled',
  OPEN:        'driverSchedule.statusBoarding',
  BOARDING:    'driverSchedule.statusBoarding',
  IN_PROGRESS: 'driverSchedule.statusInProgress',
  IN_PROGRESS_PAUSED:  'driverSchedule.statusInProgress',
  IN_PROGRESS_DELAYED: 'driverSchedule.statusInProgress',
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

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sundayOf(d: Date): Date {
  const mon = mondayOf(d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}

function originDest(trip: ScheduleTrip): string {
  const o = trip.route?.origin?.name ?? '—';
  const d = trip.route?.destination?.name ?? '—';
  return `${o} → ${d}`;
}

function isActive(status: string): boolean {
  return ['BOARDING', 'IN_PROGRESS', 'IN_PROGRESS_PAUSED', 'IN_PROGRESS_DELAYED'].includes(status);
}

function ScheduleStatusCell({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[value] ?? 'default'} size="sm">
      {STATUS_LABEL[value] ? t(STATUS_LABEL[value]) : value}
    </Badge>
  );
}

// ─── Table Columns ───────────────────────────────────────────────────────────

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

// ─── Trip Detail Dialog ──────────────────────────────────────────────────────

function TripDetailDialog({
  tripId,
  tenantId,
  onClose,
}: {
  tripId: string;
  tenantId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const { data: trip, loading, error, refetch: refetchDetail } = useFetch<TripDetail>(
    tenantId ? `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/detail` : null,
    [tenantId, tripId],
  );

  const waypoints = trip?.route?.waypoints ?? [];
  const origin = trip?.route?.origin;
  const destination = trip?.route?.destination;
  const travelersCount = trip?._count?.travelers ?? 0;
  const checklists = trip?.checklists ?? [];
  const checklistDone = checklists.filter(c => c.isCompliant).length;
  const active = trip ? isActive(trip.status) : false;

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={trip?.route?.name ?? t('driverSchedule.tripDetail')}
      description={trip ? `${formatDateFull(trip.departureScheduled)} — ${formatHm(trip.departureScheduled)}` : ''}
      size="xl"
    >
      <div className="px-6 pb-6 space-y-5">
        {loading && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        )}

        <ErrorAlert error={error} icon />

        {trip && !loading && (
          <>
            {/* ── Route with waypoints ── */}
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                {t('driverSchedule.routeLabel')}
                {trip.route?.distanceKm != null && (
                  <span className="ml-2 font-normal tabular-nums">({trip.route.distanceKm} km)</span>
                )}
              </h3>
              <div className="relative pl-6">
                {/* Origin */}
                <StopNode
                  name={origin?.name ?? '—'}
                  city={origin?.city}
                  isFirst
                  km={0}
                />

                {/* Waypoints */}
                {waypoints.map((wp) => (
                  <StopNode
                    key={wp.id}
                    name={wp.station.name}
                    city={wp.station.city}
                    km={wp.distanceFromOriginKm}
                    mandatory={wp.isMandatoryStop}
                    alert={wp.isAlertZone}
                    alertDesc={wp.alertDescription}
                    waitMin={wp.estimatedWaitTime}
                  />
                ))}

                {/* Destination */}
                <StopNode
                  name={destination?.name ?? '—'}
                  city={destination?.city}
                  isLast
                  km={trip.route?.distanceKm}
                />
              </div>
            </section>

            {/* ── Info grid ── */}
            <div className="grid grid-cols-2 gap-3">
              <InfoTile
                icon={<Clock className="w-4 h-4" />}
                label={t('driverSchedule.departure')}
                value={formatHm(trip.departureScheduled)}
              />
              <InfoTile
                icon={<Clock className="w-4 h-4" />}
                label={t('driverSchedule.arrival')}
                value={formatHm(trip.arrivalScheduled)}
              />
              <InfoTile
                icon={<Bus className="w-4 h-4" />}
                label={t('driverSchedule.vehicle')}
                value={trip.bus ? `${trip.bus.plateNumber}${trip.bus.model ? ` (${trip.bus.model})` : ''}` : '—'}
              />
              <InfoTile
                icon={<Users className="w-4 h-4" />}
                label={t('driverSchedule.passengers')}
                value={String(travelersCount)}
              />
            </div>

            {/* ── Checklist summary ── */}
            {checklists.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                  {t('driverSchedule.checklist')} — {checklistDone}/{checklists.length}
                </h3>
                <div className="space-y-1">
                  {checklists.map(item => (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 rounded text-sm',
                        item.isCompliant
                          ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/10'
                          : 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50',
                      )}
                    >
                      {item.isCompliant
                        ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
                        : <Circle className="w-4 h-4 shrink-0" aria-hidden />
                      }
                      <span className={item.isCompliant ? 'line-through' : ''}>
                        {item.label ?? t('driverSchedule.checklistItem')}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Briefing status ── */}
            <section className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
              <ClipboardCheck className="w-5 h-5 text-slate-400 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {t('driverSchedule.briefingStatus')}
                </p>
                {trip.briefing?.briefedAt ? (
                  <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" aria-hidden />
                    {t('driverSchedule.briefingDone')}
                  </p>
                ) : (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t('driverSchedule.briefingPending')}
                  </p>
                )}
              </div>
              {!trip.briefing?.briefedAt && (
                <Button size="sm" onClick={() => { onClose(); navigate('/driver/briefing'); }}>
                  {t('driverSchedule.doBriefing')}
                </Button>
              )}
            </section>

            {/* ── Status + lien raccourci ── */}
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('driverSchedule.statusLabel')}:</span>
                <ScheduleStatusCell value={trip.status} />
              </div>
              {active && (
                <Button variant="ghost" size="sm"
                  onClick={() => { onClose(); navigate('/driver'); }}>
                  <Eye className="w-4 h-4 mr-1.5" aria-hidden />
                  {t('driverSchedule.goToTrip')}
                </Button>
              )}
            </div>

            {/* ── Actions workflow — boutons mobile-friendly ──
                 Affiche les transitions contextuelles (Ouvrir embarquement,
                 Démarrer, Arrivé à destination) pilotées par le status courant.
                 Le backend fait autorité sur les transitions autorisées. */}
            <TripWorkflowActions
              tenantId={tenantId}
              tripId={trip.id}
              status={trip.status}
              role="driver"
              showManifest
              onTransitioned={() => { refetchDetail(); }}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StopNode({
  name, city, km, isFirst, isLast, mandatory, alert, alertDesc, waitMin,
}: {
  name: string;
  city?: string;
  km?: number;
  isFirst?: boolean;
  isLast?: boolean;
  mandatory?: boolean;
  alert?: boolean;
  alertDesc?: string | null;
  waitMin?: number | null;
}) {
  const dotColor = isFirst || isLast
    ? 'bg-teal-500'
    : alert
      ? 'bg-amber-500'
      : mandatory
        ? 'bg-blue-500'
        : 'bg-slate-300 dark:bg-slate-600';

  return (
    <div className="flex items-start gap-3 pb-3 last:pb-0">
      {/* Vertical line + dot */}
      <div className="relative flex flex-col items-center" style={{ width: 12 }}>
        {!isFirst && (
          <div className="absolute -top-3 w-px h-3 bg-slate-300 dark:bg-slate-600" />
        )}
        <div className={cn('w-3 h-3 rounded-full shrink-0 mt-1', dotColor)} />
        {!isLast && (
          <div className="w-px flex-1 bg-slate-300 dark:bg-slate-600 mt-1" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            'text-sm',
            (isFirst || isLast) ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300',
          )}>
            {name}
          </span>
          {city && (
            <span className="text-xs text-slate-400">({city})</span>
          )}
          {km != null && km > 0 && (
            <span className="text-xs text-slate-400 tabular-nums ml-auto">{km} km</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {mandatory && (
            <Badge variant="info" size="sm">Arrêt obligatoire</Badge>
          )}
          {alert && (
            <Badge variant="warning" size="sm">
              <AlertTriangle className="w-3 h-3 mr-1" aria-hidden />
              {alertDesc ?? 'Zone d\'alerte'}
            </Badge>
          )}
          {waitMin != null && waitMin > 0 && (
            <span className="text-xs text-slate-400">~{waitMin} min</span>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
      <div className="text-slate-400 shrink-0" aria-hidden>{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate tabular-nums">{value}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageDriverSchedule() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const now = new Date();
  const [from, setFrom] = useState(formatYmd(mondayOf(now)));
  const [to, setTo]     = useState(formatYmd(sundayOf(now)));
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        onRowClick={(trip) => setSelectedId(trip.id)}
        rowActions={[
          {
            label: t('driverSchedule.details'),
            icon: <ChevronRight className="w-4 h-4" />,
            onClick: (trip) => setSelectedId(trip.id),
          },
        ]}
      />

      {/* Trip detail dialog */}
      {selectedId && (
        <TripDetailDialog
          tripId={selectedId}
          tenantId={tenantId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}
