/**
 * PageTripPlanning — « Planning hebdomadaire » (module Trajets & Planning)
 *
 * Scope OPÉRATIONNEL flotte :
 *   - Grille VÉHICULE × JOUR de la semaine
 *   - Chaque cellule liste les trajets du bus ce jour-là (chip chronologique)
 *   - Met en évidence les conflits de créneau (double booking bus)
 *   - Bouton « Nouveau trajet » (création via même formulaire partagé)
 *
 * Distinct de PageCrewPlanning (module Équipages) qui fait la grille JOUR + RH.
 *
 * WCAG · dark mode · responsive (scroll horizontal sur mobile).
 */

import { useMemo, useState, useCallback } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, AlertTriangle, Bus, Trash2,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useI18n }       from '../../lib/i18n/useI18n';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiDelete } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }         from '../ui/Badge';
import { Skeleton }      from '../ui/Skeleton';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { cn }            from '../../lib/utils';
import {
  type TripRow, type BusLite, type StaffLite, type RouteLite,
  tripStatusBadgeVariant, tripStatusLabel,
  routeLabelOf, startOfWeek, addDays, formatYmd, formatHm,
} from './trips/shared';
import { TripCreateForm, type TripCreatePayload } from './trips/TripCreateForm';
import { TripQuickInfoDialog }                   from './trips/TripQuickInfoDialog';

// ─── i18n ─────────────────────────────────────────────────────────────────────

// i18n: namespace 'tripPlanning' — string keys used directly

function overlaps(a: TripRow, b: TripRow): boolean {
  if (!a.busId || a.busId !== b.busId || a.id === b.id) return false;
  const aStart = new Date(a.departureScheduled).getTime();
  const aEnd   = new Date(a.arrivalScheduled).getTime();
  const bStart = new Date(b.departureScheduled).getTime();
  const bEnd   = new Date(b.arrivalScheduled).getTime();
  return aStart < bEnd && bStart < aEnd;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function PageTripPlanning() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const dayLabels = ['tripPlanning.mon', 'tripPlanning.tue', 'tripPlanning.wed', 'tripPlanning.thu', 'tripPlanning.fri', 'tripPlanning.sat', 'tripPlanning.sun'];

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<string | null>(null);
  const [createBusId, setCreateBusId] = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const base = `/api/tenants/${tenantId}`;

  const { data: trips, loading: loadingTrips, error: tripsError, refetch } = useFetch<TripRow[]>(
    tenantId ? `${base}/trips` : null,
    [tenantId],
  );
  const { data: buses, loading: loadingBuses } = useFetch<BusLite[]>(
    tenantId ? `${base}/fleet/buses` : null,
    [tenantId],
  );
  const { data: drivers, loading: loadingDrivers } = useFetch<StaffLite[]>(
    showCreate ? `${base}/staff?role=DRIVER` : null,
    [tenantId, showCreate],
  );
  const { data: routesData, loading: loadingRoutes } = useFetch<RouteLite[]>(
    showCreate ? `${base}/routes` : null,
    [tenantId, showCreate],
  );

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  // ── Conflits : détection globale sur la semaine visible ──────────────────
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const weekTrips = (trips ?? []).filter(t => {
      const ts = new Date(t.departureScheduled).getTime();
      return ts >= weekStart.getTime() && ts < weekEnd.getTime();
    });
    for (let i = 0; i < weekTrips.length; i += 1) {
      for (let j = i + 1; j < weekTrips.length; j += 1) {
        if (overlaps(weekTrips[i], weekTrips[j])) {
          ids.add(weekTrips[i].id);
          ids.add(weekTrips[j].id);
        }
      }
    }
    return ids;
  }, [trips, weekStart, weekEnd]);

  // ── Index Bus → Jour → Trajets ──────────────────────────────────────────
  const cellIndex = useMemo(() => {
    const map = new Map<string, TripRow[]>();  // key = `${busId}:${dayIdx}`
    (trips ?? []).forEach(t => {
      if (!t.busId) return;
      const d = new Date(t.departureScheduled);
      if (d < weekStart || d >= weekEnd) return;
      const dayIdx = Math.floor((d.getTime() - weekStart.getTime()) / 86_400_000);
      if (dayIdx < 0 || dayIdx > 6) return;
      const key = `${t.busId}:${dayIdx}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    map.forEach(list =>
      list.sort((a, b) => new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime()),
    );
    return map;
  }, [trips, weekStart, weekEnd]);

  const weekTotal = useMemo(() =>
    (trips ?? []).filter(t => {
      const ts = new Date(t.departureScheduled).getTime();
      return ts >= weekStart.getTime() && ts < weekEnd.getTime();
    }).length,
    [trips, weekStart, weekEnd],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  const openCreate = (date: Date, busId?: string) => {
    setCreateDate(formatYmd(date));
    setCreateBusId(busId ?? null);
    setShowCreate(true);
    setActionError(null);
  };

  const handleDelete = useCallback(async (tripId: string) => {
    setDeletingId(tripId);
    setActionError(null);
    try {
      await apiDelete(`${base}/trips/${tripId}`);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('tripPlanning.deleteError'));
    } finally {
      setDeletingId(null);
    }
  }, [base, refetch, t]);

  const handleCreate = async (payload: TripCreatePayload) => {
    setBusy(true); setActionError(null);
    try {
      await apiPost(`${base}/trips`, payload);
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('tripPlanning.createError'));
    } finally { setBusy(false); }
  };

  const routes = routesData ?? [];

  // Réordonne buses pour que le bus pré-sélectionné soit en tête
  const busesForForm: BusLite[] = useMemo(() => {
    const arr = buses ?? [];
    if (!createBusId) return arr;
    return [...arr].sort((a, b) =>
      a.id === createBusId ? -1 : b.id === createBusId ? 1 : 0,
    );
  }, [buses, createBusId]);

  // ── Navigation semaine ───────────────────────────────────────────────────
  const goPrev  = () => setWeekStart(w => addDays(w, -7));
  const goNext  = () => setWeekStart(w => addDays(w,  7));
  const goToday = () => setWeekStart(startOfWeek(new Date()));

  const formatWeekRange = (start: Date): string => {
    const end = addDays(start, 6);
    const s = start.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    const e = end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${s} — ${e}`;
  };

  const loading = loadingTrips || loadingBuses;

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('tripPlanning.pageTitle')}>
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <CalendarDays className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('tripPlanning.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('tripPlanning.pageDesc')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1" role="toolbar" aria-label={t('tripPlanning.weekNav')}>
            <Button size="sm" variant="ghost" onClick={goPrev} aria-label={t('tripPlanning.prevWeek')}>
              <ChevronLeft className="w-4 h-4" aria-hidden />
            </Button>
            <Button size="sm" variant="ghost" onClick={goToday} aria-label={t('tripPlanning.backToWeek')}>
              {t('tripPlanning.today')}
            </Button>
            <span className="px-2 text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap" aria-live="polite">
              {formatWeekRange(weekStart)}
            </span>
            <Button size="sm" variant="ghost" onClick={goNext} aria-label={t('tripPlanning.nextWeek')}>
              <ChevronRight className="w-4 h-4" aria-hidden />
            </Button>
          </div>
          <Button onClick={() => openCreate(new Date())} aria-label={t('tripPlanning.createTrip')}>
            <Plus className="w-4 h-4 mr-2" aria-hidden />{t('tripPlanning.newTrip')}
          </Button>
        </div>
      </div>

      <ErrorAlert error={tripsError} icon />

      {/* KPIs */}
      <section aria-label={t('tripPlanning.pageTitle')} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiLite label={t('tripPlanning.tripsPerWeek')}   value={weekTotal} />
        <KpiLite label={t('tripPlanning.activeVehicles')} value={buses?.length ?? 0} />
        <KpiLite label={t('tripPlanning.conflictsFound')} value={conflictIds.size / 2} danger />
        <KpiLite label={t('tripPlanning.avgUsage')} value={
          buses && buses.length > 0 ? Math.round((weekTotal / (buses.length * 7)) * 100) : 0
        } suffix="%" />
      </section>

      {/* Grille */}
      <Card>
        <CardHeader
          heading={t('tripPlanning.weekGrid')}
          description={t('tripPlanning.gridClickHint')}
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : !buses || buses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <Bus className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('tripPlanning.noVehicles')}</p>
              <p className="text-sm mt-1">{t('tripPlanning.noVehiclesCta')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]" role="grid" aria-label={t('tripPlanning.gridLabel')}>
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
                    <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-40">
                      {t('tripPlanning.vehicle')}
                    </th>
                    {dayLabels.map((label, i) => {
                      const d = addDays(weekStart, i);
                      const isToday = d.toDateString() === new Date().toDateString();
                      return (
                        <th
                          key={i}
                          className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                          scope="col"
                        >
                          <div>{t(label)}</div>
                          <div className={cn(
                            'tabular-nums',
                            isToday && 'text-teal-600 dark:text-teal-400',
                          )}>
                            {d.getDate().toString().padStart(2, '0')}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {buses.map(b => (
                    <tr key={b.id} className="border-b border-slate-100 dark:border-slate-800">
                      <th scope="row" className="text-left px-4 py-3 align-top">
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.plateNumber}</p>
                        {b.model && <p className="text-[11px] text-slate-500">{b.model}</p>}
                      </th>
                      {dayLabels.map((_, dayIdx) => {
                        const dayDate = addDays(weekStart, dayIdx);
                        const cellTrips = cellIndex.get(`${b.id}:${dayIdx}`) ?? [];
                        return (
                          <td
                            key={dayIdx}
                            role="gridcell"
                            className="align-top p-1.5 min-w-[120px]"
                          >
                            {cellTrips.length === 0 ? (
                              <button
                                onClick={() => openCreate(dayDate, b.id)}
                                className="w-full h-12 rounded-md border border-dashed border-slate-200 dark:border-slate-700 text-slate-400 hover:text-teal-600 hover:border-teal-400 dark:hover:text-teal-400 dark:hover:border-teal-500 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                                aria-label={`${t('tripPlanning.newTrip')} ${b.plateNumber} ${dayDate.toLocaleDateString('fr-FR')}`}
                              >
                                <Plus className="w-3.5 h-3.5" aria-hidden />
                              </button>
                            ) : (
                              <ul className="space-y-1" role="list">
                                {cellTrips.map(tr => {
                                  const isConflict = conflictIds.has(tr.id);
                                  const isDeleting = deletingId === tr.id;
                                  const isPlanned  = tr.status === 'PLANNED';
                                  return (
                                    <li key={tr.id}>
                                      <button
                                        type="button"
                                        onClick={() => setSelectedTripId(tr.id)}
                                        aria-label={`${t('tripQuickInfo.title')} · ${formatHm(new Date(tr.departureScheduled))} · ${routeLabelOf(tr)}`}
                                        className={cn(
                                          'w-full text-left rounded-md border px-2 py-1.5 text-xs group relative cursor-pointer',
                                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                                          'hover:shadow-sm transition-shadow',
                                          isConflict
                                            ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/30'
                                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500',
                                          isDeleting && 'opacity-50',
                                        )}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
                                            {formatHm(new Date(tr.departureScheduled))}
                                          </span>
                                          <div className="flex items-center gap-1">
                                            {isConflict && (
                                              <AlertTriangle className="w-3 h-3 text-red-500" aria-label={t('tripPlanning.conflictLabel')} />
                                            )}
                                            {isPlanned && (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(e) => { e.stopPropagation(); handleDelete(tr.id); }}
                                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleDelete(tr.id); } }}
                                                aria-disabled={isDeleting}
                                                aria-label={t('tripPlanning.deleteTrip')}
                                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-600 dark:hover:text-red-400 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                              >
                                                <Trash2 className="w-3 h-3" aria-hidden />
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <p className="truncate text-slate-600 dark:text-slate-400">{routeLabelOf(tr)}</p>
                                        <Badge variant={tripStatusBadgeVariant(tr.status)} size="sm">
                                          {tripStatusLabel(tr.status)}
                                        </Badge>
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal détail trajet */}
      {selectedTripId && (
        <TripQuickInfoDialog
          tripId={selectedTripId}
          tenantId={tenantId}
          onClose={() => setSelectedTripId(null)}
        />
      )}

      {/* Modal Nouveau trajet */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) { setShowCreate(false); setActionError(null); } }}
        title={t('tripPlanning.dialogNewTitle')}
        description={t('tripPlanning.dialogNewDesc')}
        size="lg"
      >
        {showCreate && (loadingDrivers || loadingRoutes ? (
          <div className="flex items-center justify-center py-8">
            <Skeleton className="h-10 w-48" />
          </div>
        ) : (
          <TripCreateForm
            routes={routes}
            buses={busesForForm}
            drivers={drivers ?? []}
            defaultDate={createDate ?? formatYmd(new Date())}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); setActionError(null); }}
            busy={busy}
            error={actionError}
          />
        ))}
      </Dialog>
    </main>
  );
}

function KpiLite({ label, value, suffix, danger }: { label: string; value: number; suffix?: string; danger?: boolean }) {
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
      aria-label={`${label}: ${value}${suffix ?? ''}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn(
        'text-xl font-bold tabular-nums',
        danger && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-50',
      )}>
        {value}{suffix}
      </p>
    </article>
  );
}
