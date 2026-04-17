/**
 * PageTrips — « Trajets du jour » (module Trajets & Planning)
 *
 * Scope OPÉRATIONNEL :
 *   - Liste des trajets de la journée courante
 *   - Statut live, départ/arrivée, véhicule, chauffeur
 *   - Création d'un trajet (bouton « Nouveau trajet »)
 *   - Filtres statut / recherche route
 *
 * Ne gère PAS l'affectation d'équipage → c'est le rôle de PageCrewPlanning.
 *
 * WCAG 2.1 AA · Dark mode · responsive.
 */

import { useMemo, useState } from 'react';
import {
  Route as RouteIcon, Plus, Search, Bus, Clock, MapPin, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useI18n }        from '../../lib/i18n/useI18n';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }         from '../ui/Badge';
import { Skeleton }      from '../ui/Skeleton';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { inputClass }    from '../ui/inputClass';
import { cn }            from '../../lib/utils';
import {
  type TripRow, type BusLite, type StaffLite, type RouteLite,
  tripStatusLabel, tripStatusBadgeVariant,
  routeLabelOf, startOfDay, formatYmd, formatHm, isTripDelayed, delayMinutes,
} from './trips/shared';
import { TripCreateForm, type TripCreatePayload } from './trips/TripCreateForm';

// ─── i18n ─────────────────────────────────────────────────────────────────────

// ─── i18n (string-key based — see locales/fr.ts → trips) ────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isToday(d: Date, ref = new Date()): boolean {
  return d.toDateString() === ref.toDateString();
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function PageTrips() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const [dayOffset,   setDayOffset]   = useState(0);   // 0 = aujourd'hui, -1 = hier, +1 = demain
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search,       setSearch]       = useState<string>('');
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTrip,     setEditTrip]     = useState<TripRow | null>(null);
  const [editMode,     setEditMode]     = useState<'FREE' | 'NUMBERED'>('FREE');
  const [busy,         setBusy]         = useState(false);
  const [actionError,  setActionError]  = useState<string | null>(null);

  const base = `/api/tenants/${tenantId}`;

  const { data: trips, loading, error, refetch } = useFetch<TripRow[]>(
    tenantId ? `${base}/trips` : null,
    [tenantId],
  );

  const { data: buses } = useFetch<BusLite[]>(
    showCreate ? `${base}/fleet/buses` : null,
    [tenantId, showCreate],
  );
  const { data: staffList } = useFetch<StaffLite[]>(
    showCreate ? `${base}/staff?role=DRIVER` : null,
    [tenantId, showCreate],
  );
  const { data: routesData } = useFetch<RouteLite[]>(
    showCreate ? `${base}/routes` : null,
    [tenantId, showCreate],
  );

  // ── Filtrage ───────────────────────────────────────────────────────────────
  const refDay = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    return startOfDay(d);
  }, [dayOffset]);

  const visible = useMemo(() => {
    const refDayTs = refDay.getTime();
    const nextDayTs = refDayTs + 24 * 60 * 60 * 1000;
    const q = search.trim().toLowerCase();
    return (trips ?? [])
      .filter(t => {
        const ts = new Date(t.departureScheduled).getTime();
        if (ts < refDayTs || ts >= nextDayTs) return false;
        if (statusFilter && t.status !== statusFilter) return false;
        if (q && !routeLabelOf(t).toLowerCase().includes(q)
              && !(t.bus?.plateNumber ?? '').toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        new Date(a.departureScheduled).getTime() - new Date(b.departureScheduled).getTime(),
      );
  }, [trips, refDay, statusFilter, search]);

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    let delayed = 0, inProgress = 0, completed = 0;
    visible.forEach(t => {
      if (isTripDelayed(t)) delayed += 1;
      if (t.status === 'IN_PROGRESS' || t.status === 'BOARDING') inProgress += 1;
      if (t.status === 'COMPLETED') completed += 1;
    });
    return { total: visible.length, delayed, inProgress, completed };
  }, [visible]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleCreate = async (payload: TripCreatePayload) => {
    setBusy(true); setActionError(null);
    try {
      await apiPost(`${base}/trips`, payload);
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('trips.createError'));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (trip: TripRow) => {
    setEditTrip(trip);
    setEditMode((trip.seatingMode as 'FREE' | 'NUMBERED') ?? 'FREE');
    setActionError(null);
  };

  const handleUpdateSeatingMode = async () => {
    if (!editTrip) return;
    setBusy(true); setActionError(null);
    try {
      await apiPatch(`${base}/trips/${editTrip.id}`, { seatingMode: editMode });
      setEditTrip(null);
      refetch();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('trips.createError'));
    } finally {
      setBusy(false);
    }
  };

  const routes  = routesData ?? [];
  const drivers = staffList ?? [];

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('trips.pageTitle')}>
      {/* En-tête */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <RouteIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('trips.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('trips.pageDesc')}
            </p>
          </div>
        </div>
        <Button
          onClick={() => { setShowCreate(true); setActionError(null); }}
          aria-label={t('trips.createTrip')}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('trips.newTrip')}
        </Button>
      </div>

      <ErrorAlert error={error} icon />

      {/* KPIs */}
      <section aria-label={t('trips.trips')} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Kpi label={t('trips.trips')}      value={kpi.total}      icon={<RouteIcon className="w-5 h-5" />} tone="neutral" />
        <Kpi label={t('trips.inProgress')} value={kpi.inProgress} icon={<Bus className="w-5 h-5" />}       tone="info" />
        <Kpi label={t('trips.delayed')}    value={kpi.delayed}    icon={<AlertTriangle className="w-5 h-5" />} tone={kpi.delayed > 0 ? 'danger' : 'success'} />
        <Kpi label={t('trips.completed')}  value={kpi.completed}  icon={<CheckCircle2 className="w-5 h-5" />} tone="success" />
      </section>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1" role="toolbar" aria-label={t('trips.dayNav')}>
          {[-1, 0, 1].map(off => (
            <button
              key={off}
              onClick={() => setDayOffset(off)}
              aria-pressed={dayOffset === off}
              className={cn(
                'px-3 py-1 text-sm font-medium rounded-md transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                dayOffset === off
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
              )}
            >
              {off === -1 ? t('trips.yesterday') : off === 0 ? t('trips.today') : t('trips.tomorrow')}
            </button>
          ))}
        </div>

        <div className="text-sm text-slate-500 tabular-nums" aria-live="polite">
          {refDay.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          {isToday(refDay) && <span className="ml-2 text-teal-600 dark:text-teal-400">• live</span>}
        </div>

        <div className="flex-1 min-w-[180px] flex items-center gap-3 ml-auto">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('trips.searchTrip')}
              className={cn(inputClass, 'pl-9')}
              aria-label={t('trips.searchLabel')}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className={cn(inputClass, 'w-auto')}
            aria-label={t('trips.filterStatus')}
          >
            <option value="">{t('trips.allStatuses')}</option>
            {['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'IN_PROGRESS_DELAYED', 'COMPLETED', 'CANCELLED'].map(s => (
              <option key={s} value={s}>{tripStatusLabel(s)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Liste */}
      <Card>
        <CardHeader
          heading={`${visible.length} ${t('trips.trips').toLowerCase()}`}
          description={t('trips.clickDetails')}
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <RouteIcon className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('trips.noTripsDay')}</p>
              <p className="text-sm mt-1">{t('trips.noTripsCta')}</p>
            </div>
          ) : (
            <div role="table" aria-label={t('trips.trips')}>
              <div
                role="row"
                className="grid grid-cols-[90px_1fr_120px_160px_140px] gap-3 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50"
              >
                <div role="columnheader">{t('trips.hour')}</div>
                <div role="columnheader">{t('trips.route')}</div>
                <div role="columnheader">{t('trips.vehicle')}</div>
                <div role="columnheader">{t('trips.status')}</div>
                <div role="columnheader" className="text-right">{t('trips.delay')}</div>
              </div>
              <ul role="rowgroup" className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map(t2 => {
                  const d = new Date(t2.departureScheduled);
                  const delayed = isTripDelayed(t2);
                  const mn = delayMinutes(t2);
                  return (
                    <li
                      key={t2.id}
                      role="row"
                      onClick={() => openEdit(t2)}
                      className={cn(
                        'grid grid-cols-[90px_1fr_120px_160px_140px] gap-3 px-6 py-3 items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors',
                        delayed && 'bg-red-50/50 dark:bg-red-900/10',
                      )}
                    >
                      <div role="cell" className="flex items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                        <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
                        {formatHm(d)}
                      </div>
                      <div role="cell" className="flex items-center gap-2 min-w-0">
                        <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                        <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{routeLabelOf(t2)}</span>
                      </div>
                      <div role="cell" className="text-sm font-mono text-slate-600 dark:text-slate-400 truncate">
                        {t2.bus?.plateNumber ?? '—'}
                      </div>
                      <div role="cell" className="flex items-center gap-1.5">
                        <Badge variant={tripStatusBadgeVariant(t2.status)} size="sm">
                          {tripStatusLabel(t2.status)}
                        </Badge>
                        {t2.seatingMode === 'NUMBERED' && (
                          <Badge variant="info" size="sm">
                            {t('tripForm.numberedSeating')}
                          </Badge>
                        )}
                      </div>
                      <div role="cell" className="text-right">
                        {delayed
                          ? <Badge variant="danger" size="sm">+{mn} min</Badge>
                          : <span className="text-xs text-slate-400">—</span>
                        }
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Nouveau trajet */}
      <Dialog
        open={showCreate}
        onOpenChange={o => { if (!o) { setShowCreate(false); setActionError(null); } }}
        title={t('trips.dialogNewTitle')}
        description={t('trips.dialogNewDesc')}
        size="lg"
      >
        {showCreate && (
          <TripCreateForm
            routes={routes}
            buses={buses ?? []}
            drivers={drivers}
            defaultDate={formatYmd(refDay)}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); setActionError(null); }}
            busy={busy}
            error={actionError}
          />
        )}
      </Dialog>

      {/* Modal Modifier trajet — seatingMode */}
      <Dialog
        open={!!editTrip}
        onOpenChange={o => { if (!o) { setEditTrip(null); setActionError(null); } }}
        title={t('trips.editTripTitle')}
        description={editTrip ? `${routeLabelOf(editTrip)} — ${formatHm(new Date(editTrip.departureScheduled))}` : ''}
        size="md"
      >
        {editTrip && (
          <div className="space-y-5">
            <ErrorAlert error={actionError} />

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('tripForm.seatingMode')}
              </label>
              <div className="flex gap-3">
                {(['FREE', 'NUMBERED'] as const).map(mode => {
                  const busSeatLayout = editTrip.bus?.seatLayout;
                  const disabled = mode === 'NUMBERED' && !busSeatLayout;
                  return (
                    <label key={mode} className={cn(
                      'flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium',
                      editMode === mode
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-slate-300',
                      disabled && 'opacity-50 cursor-not-allowed',
                    )}>
                      <input
                        type="radio" name="editSeatingMode" value={mode}
                        checked={editMode === mode}
                        onChange={() => setEditMode(mode)}
                        disabled={busy || disabled}
                        className="sr-only"
                      />
                      {mode === 'FREE' ? t('tripForm.freeSeating') : t('tripForm.numberedSeating')}
                    </label>
                  );
                })}
              </div>
              {!editTrip.bus?.seatLayout && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  {t('tripForm.noSeatLayoutHint')}
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setEditTrip(null); setActionError(null); }}
                disabled={busy}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg font-medium text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleUpdateSeatingMode}
                disabled={busy || editMode === (editTrip.seatingMode ?? 'FREE')}
                className={cn(
                  'flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors',
                  editMode !== (editTrip.seatingMode ?? 'FREE') && !busy
                    ? 'bg-teal-600 text-white hover:bg-teal-700'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed',
                )}
              >
                {busy ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}

// ─── Composant KPI local ─────────────────────────────────────────────────────

function Kpi({
  label, value, icon, tone,
}: {
  label: string; value: number; icon: React.ReactNode;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
    info:    'bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 dark:text-emerald-400',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400',
    danger:  'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',
  };
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}`}
    >
      <div className={cn('p-2.5 rounded-lg shrink-0', tones[tone])} aria-hidden>{icon}</div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{value}</p>
      </div>
    </article>
  );
}
