/**
 * PageCrewPlanning — Planning hebdomadaire des équipages
 *
 * Vue semaine : trajets + affectations équipage (assign / unassign / mark briefed).
 *
 * Endpoints :
 *   GET    /api/tenants/:tid/trips
 *   GET    /api/tenants/:tid/staff?role=...
 *   GET    /api/tenants/:tid/trips/:tripId/crew
 *   POST   /api/tenants/:tid/trips/:tripId/crew        body { staffId, crewRole }
 *   PATCH  /api/tenants/:tid/trips/:tripId/crew/:sid/briefed
 *   DELETE /api/tenants/:tid/trips/:tripId/crew/:sid
 *
 * WCAG 2.1 AA · Dark mode · responsive
 */

import { useMemo, useState, useCallback, type FormEvent } from 'react';
import {
  CalendarRange, ChevronLeft, ChevronRight, Users, UserPlus,
  CheckCircle2, X, Bus, MapPin,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }         from '../ui/Badge';
import { Skeleton }      from '../ui/Skeleton';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { FormFooter }    from '../ui/FormFooter';
import { inputClass }    from '../ui/inputClass';
import { cn }            from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type CrewRole = 'CO_PILOT' | 'HOSTESS' | 'SECURITY' | 'MECHANIC_ON_BOARD';

const CREW_ROLES: { value: CrewRole; label: string }[] = [
  { value: 'CO_PILOT',          label: 'crewPlanning.coPilot' },
  { value: 'HOSTESS',           label: 'crewPlanning.hostess' },
  { value: 'SECURITY',          label: 'crewPlanning.security' },
  { value: 'MECHANIC_ON_BOARD', label: 'crewPlanning.mechanicOnBoard' },
];

// routeLabel is now resolved inside components using t()

interface TripRow {
  id:                 string;
  routeId:            string;
  busId?:             string | null;
  departureScheduled: string;
  arrivalScheduled:   string;
  status:             string;
  route: {
    id?:              string;
    name?:            string | null;
    label?:           string | null;
    originName?:      string | null;
    destinationName?: string | null;
  } | null;
  bus:   { plateNumber?: string | null; model?: string | null } | null;
  driverId?: string | null;
}


interface StaffRow {
  id:     string;
  userId: string;
  role:   string;
  isAvailable: boolean;
  user: { email: string; name?: string | null; displayName?: string | null };
}

interface CrewAssignment {
  id:        string;
  tripId:    string;
  staffId:   string;           // = userId (voir CrewService)
  crewRole:  CrewRole | string;
  briefedAt: string | null;
}

// ─── Helpers semaine ──────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const res = new Date(d);
  const day = (res.getDay() + 6) % 7; // lundi = 0
  res.setHours(0, 0, 0, 0);
  res.setDate(res.getDate() - day);
  return res;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const DAY_LABELS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;
const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString('fr-FR', { day: '2-digit', month: sameMonth ? undefined : 'short' });
  const e = end.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${s} — ${e}`;
}

// ─── Nom affiché d'un staff ───────────────────────────────────────────────────

function staffDisplayName(s: StaffRow): string {
  return s.user.displayName ?? s.user.name ?? s.user.email;
}

// NOTE — la création de trajets est désormais gérée dans le module « Trajets & Planning »
// (trips-list / trips-planning). Cette page reste focalisée sur la vue RH :
// affectation d'équipage sur trajets existants + conformité briefing.

// ─── Modal : Affecter un membre d'équipage ────────────────────────────────────

interface AssignFormValues { staffUserId: string; crewRole: CrewRole }

function AssignCrewForm({
  eligibleStaff, onSubmit, onCancel, busy, error,
}: {
  eligibleStaff: StaffRow[];
  onSubmit: (f: AssignFormValues) => void;
  onCancel: () => void;
  busy:  boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<AssignFormValues>({
    staffUserId: eligibleStaff[0]?.userId ?? '',
    crewRole:    'CO_PILOT',
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(values); }}
    >
      <ErrorAlert error={error} />

      <div className="space-y-1.5">
        <label htmlFor="assign-staff" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('crewPlanning.staffMember')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <select
          id="assign-staff"
          required
          value={values.staffUserId}
          onChange={e => setValues(p => ({ ...p, staffUserId: e.target.value }))}
          className={inputClass}
          disabled={busy || eligibleStaff.length === 0}
        >
          {eligibleStaff.length === 0 && <option value="">{t('crewPlanning.noMember')}</option>}
          {eligibleStaff.map(s => (
            <option key={s.id} value={s.userId}>
              {staffDisplayName(s)} — {s.role}{!s.isAvailable ? ` ${t('crewPlanning.atRest')}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="assign-role" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('crewPlanning.crewRole')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <select
          id="assign-role"
          required
          value={values.crewRole}
          onChange={e => setValues(p => ({ ...p, crewRole: e.target.value as CrewRole }))}
          className={inputClass}
          disabled={busy}
        >
          {CREW_ROLES.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
        </select>
      </div>

      <FormFooter
        onCancel={onCancel}
        busy={busy}
        submitLabel={t('crewPlanning.assign')}
        pendingLabel={t('crewPlanning.assigning')}
      />
    </form>
  );
}

// ─── Carte d'un trajet avec son équipage ──────────────────────────────────────

interface TripCardProps {
  trip:             TripRow;
  assignments:      CrewAssignment[] | null;
  loadingCrew:      boolean;
  onAssignClick:    () => void;
  onMarkBriefed:    (staffId: string) => void;
  onRemove:         (staffId: string) => void;
  busyStaff:        Set<string>;
  staffIndex:       Map<string, StaffRow>;
}

function TripCard({
  trip, assignments, loadingCrew, onAssignClick, onMarkBriefed, onRemove, busyStaff, staffIndex,
}: TripCardProps) {
  const { t } = useI18n();
  const roleLabel = (v: string): string => {
    const found = CREW_ROLES.find(r => r.value === v);
    return found ? t(found.label) : v;
  };
  const dep  = new Date(trip.departureScheduled);
  const when = dep.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const routeLabel = trip.route?.label
    ?? [trip.route?.originName, trip.route?.destinationName].filter(Boolean).join(' → ')
    ?? t('crewPlanning.unknownRoute');

  const briefedCount = assignments?.filter(a => a.briefedAt).length ?? 0;
  const totalCount   = assignments?.length ?? 0;
  const allBriefed   = totalCount > 0 && briefedCount === totalCount;

  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      aria-labelledby={`trip-${trip.id}-title`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={`trip-${trip.id}-title`} className="font-semibold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
            <span className="truncate">{routeLabel}</span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2">
            <span className="tabular-nums font-medium">{when}</span>
            {trip.bus?.plateNumber && (
              <>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1"><Bus className="w-3 h-3" aria-hidden />{trip.bus.plateNumber}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <Badge variant="default" size="sm">{trip.status}</Badge>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onAssignClick}
          aria-label={`Affecter un membre d'équipage au trajet ${routeLabel} de ${when}`}
        >
          <UserPlus className="w-4 h-4 mr-1.5" aria-hidden />{t('crewPlanning.assign')}
        </Button>
      </header>

      <div
        className={cn(
          'rounded-lg border',
          allBriefed
            ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-900/10'
            : 'border-slate-100 dark:border-slate-800',
        )}
      >
        {loadingCrew ? (
          <div className="p-3 space-y-2" aria-busy="true">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : !assignments || assignments.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-500 dark:text-slate-400 text-center">
            {t('crewPlanning.noCrew')}
          </p>
        ) : (
          <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
            {assignments.map(a => {
              const staff = staffIndex.get(a.staffId);
              const name  = staff ? staffDisplayName(staff) : a.staffId;
              const busy  = busyStaff.has(a.staffId);
              return (
                <li key={a.id} className="flex items-center justify-between px-3 py-2 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[11px] font-bold text-slate-700 dark:text-slate-300 shrink-0"
                      aria-hidden
                    >
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{name}</p>
                      <p className="text-[11px] text-slate-500">{roleLabel(String(a.crewRole))}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.briefedAt ? (
                      <Badge variant="success" size="sm">{t('crewPlanning.briefed')}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onMarkBriefed(a.staffId)}
                        aria-label={`Marquer ${name} comme briefé`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden />{t('crewPlanning.brief')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onRemove(a.staffId)}
                      aria-label={`Retirer ${name} de l'affectation`}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalCount > 0 && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {briefedCount}/{totalCount} {t('crewPlanning.briefingsCompleted')}
        </p>
      )}
    </article>
  );
}

// ─── Wrapper qui fetch l'équipage d'un trip ───────────────────────────────────

function TripCardWithCrew(props: {
  trip: TripRow;
  tenantId: string;
  onAssignClick: (trip: TripRow) => void;
  staffIndex: Map<string, StaffRow>;
  refreshKey: number;
  onAction: () => void;
}) {
  const { trip, tenantId, onAssignClick, staffIndex, refreshKey, onAction } = props;

  const { data: assignments, loading, refetch } = useFetch<CrewAssignment[]>(
    `/api/tenants/${tenantId}/trips/${trip.id}/crew`,
    [tenantId, trip.id, refreshKey],
  );

  const [busyStaff, setBusyStaff] = useState<Set<string>>(new Set());

  const markBusy = useCallback((sid: string, on: boolean) => {
    setBusyStaff(prev => {
      const next = new Set(prev);
      if (on) next.add(sid); else next.delete(sid);
      return next;
    });
  }, []);

  const doBrief = useCallback(async (staffId: string) => {
    markBusy(staffId, true);
    try {
      await apiPatch(`/api/tenants/${tenantId}/trips/${trip.id}/crew/${staffId}/briefed`);
      refetch();
      onAction();
    } finally { markBusy(staffId, false); }
  }, [tenantId, trip.id, markBusy, refetch, onAction]);

  const doRemove = useCallback(async (staffId: string) => {
    markBusy(staffId, true);
    try {
      await apiDelete(`/api/tenants/${tenantId}/trips/${trip.id}/crew/${staffId}`);
      refetch();
      onAction();
    } finally { markBusy(staffId, false); }
  }, [tenantId, trip.id, markBusy, refetch, onAction]);

  return (
    <TripCard
      trip={trip}
      assignments={assignments}
      loadingCrew={loading}
      onAssignClick={() => onAssignClick(trip)}
      onMarkBriefed={doBrief}
      onRemove={doRemove}
      busyStaff={busyStaff}
      staffIndex={staffIndex}
    />
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageCrewPlanning() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const DAY_LABELS = lang === 'en' ? DAY_LABELS_EN : DAY_LABELS_FR;
  const tenantId = user?.tenantId ?? '';

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [activeDay, setActiveDay] = useState<number>(() => {
    const today = new Date();
    const start = startOfWeek(today);
    const diff  = Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, Math.min(6, diff));
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [assignTarget, setAssignTarget] = useState<TripRow | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: trips, loading: loadingTrips, error: tripsError } = useFetch<TripRow[]>(
    tenantId ? `/api/tenants/${tenantId}/trips` : null,
    [tenantId, refreshKey],
  );

  const { data: staffList } = useFetch<StaffRow[]>(
    tenantId ? `/api/tenants/${tenantId}/staff` : null,
    [tenantId],
  );

  const staffIndex = useMemo(() => {
    const map = new Map<string, StaffRow>();
    (staffList ?? []).forEach(s => map.set(s.userId, s));
    return map;
  }, [staffList]);

  // ── Filtrage semaine / jour ──────────────────────────────────────────────
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  const tripsByDay = useMemo(() => {
    const buckets: TripRow[][] = Array.from({ length: 7 }, () => []);
    (trips ?? []).forEach(t => {
      const d = new Date(t.departureScheduled);
      if (d < weekStart || d >= weekEnd) return;
      const idx = Math.floor((d.getTime() - weekStart.getTime()) / (24 * 60 * 60 * 1000));
      if (idx >= 0 && idx < 7) buckets[idx].push(t);
    });
    buckets.forEach(b =>
      b.sort((a, c) => new Date(a.departureScheduled).getTime() - new Date(c.departureScheduled).getTime()),
    );
    return buckets;
  }, [trips, weekStart, weekEnd]);

  const visibleTrips = tripsByDay[activeDay] ?? [];
  const totalWeekTrips = tripsByDay.reduce((acc, b) => acc + b.length, 0);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const goPrev  = () => setWeekStart(w => addDays(w, -7));
  const goNext  = () => setWeekStart(w => addDays(w, 7));
  const goToday = () => {
    const s = startOfWeek(new Date());
    setWeekStart(s);
    setActiveDay(((new Date().getDay() + 6) % 7));
  };

  const handleAssignSubmit = async (f: AssignFormValues) => {
    if (!assignTarget) return;
    setAssignBusy(true);
    setAssignError(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/trips/${assignTarget.id}/crew`, {
        staffId:  f.staffUserId,
        crewRole: f.crewRole,
      });
      setAssignTarget(null);
      setRefreshKey(k => k + 1);
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Erreur lors de l\'affectation');
    } finally {
      setAssignBusy(false);
    }
  };

  const eligibleStaff = useMemo(
    () => (staffList ?? []).filter(s =>
      ['DRIVER', 'HOSTESS', 'MECHANIC', 'CONTROLLER', 'SUPERVISOR'].includes(s.role),
    ),
    [staffList],
  );

  // ── Rendu ────────────────────────────────────────────────────────────────
  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('crewPlanning.pageTitle')}>
      {/* En-tete */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <CalendarRange className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('crewPlanning.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('crewPlanning.pageDesc')}
            </p>
          </div>
        </div>

        {/* Navigation semaine */}
        <div
          className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1"
          role="toolbar"
          aria-label={t('crewPlanning.weekNav')}
        >
          <Button size="sm" variant="ghost" onClick={goPrev} aria-label={t('crewPlanning.prevWeek')}>
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={goToday} aria-label={t('crewPlanning.backToWeek')}>
            {t('crewPlanning.today')}
          </Button>
          <span className="px-2 text-sm font-medium text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap" aria-live="polite">
            {formatWeekRange(weekStart)}
          </span>
          <Button size="sm" variant="ghost" onClick={goNext} aria-label={t('crewPlanning.nextWeek')}>
            <ChevronRight className="w-4 h-4" aria-hidden />
          </Button>
        </div>
      </div>

      <ErrorAlert error={tripsError} icon />

      {/* KPI */}
      <section aria-label={t('crewPlanning.weekIndicators')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {DAY_LABELS.map((label, i) => {
            const d  = addDays(weekStart, i);
            const n  = tripsByDay[i].length;
            const isActive = i === activeDay;
            const isToday  =
              d.toDateString() === new Date().toDateString();
            return (
              <button
                key={label}
                onClick={() => setActiveDay(i)}
                aria-pressed={isActive}
                aria-label={`${label} ${d.toLocaleDateString('fr-FR')} — ${n} ${t('crewPlanning.trips')}`}
                className={cn(
                  'text-left rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  isActive
                    ? 'bg-teal-50 border-teal-300 dark:bg-teal-900/30 dark:border-teal-700'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700',
                )}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label}{isToday && <span className="ml-1 text-teal-600 dark:text-teal-400">•</span>}
                </p>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-50 tabular-nums mt-0.5">
                  {d.getDate().toString().padStart(2, '0')}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {n} {t('crewPlanning.trips')}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Liste trajets du jour */}
      <Card>
        <CardHeader
          heading={`${t('crewPlanning.tripsOfDay')} ${addDays(weekStart, activeDay).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`}
          description={`${visibleTrips.length} ${t('crewPlanning.displayedTrips')} · ${totalWeekTrips} ${t('crewPlanning.onWeek')}`}
        />
        <CardContent className="p-4">
          {loadingTrips ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
            </div>
          ) : visibleTrips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <Users className="w-12 h-12 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('crewPlanning.noTrip')}</p>
              <p className="text-sm mt-1">{t('crewPlanning.noTripHint')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visibleTrips.map(trip => (
                <TripCardWithCrew
                  key={trip.id}
                  trip={trip}
                  tenantId={tenantId}
                  staffIndex={staffIndex}
                  refreshKey={refreshKey}
                  onAssignClick={tr => { setAssignTarget(tr); setAssignError(null); }}
                  onAction={() => setRefreshKey(k => k + 1)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal Affectation */}
      <Dialog
        open={!!assignTarget}
        onOpenChange={o => { if (!o) { setAssignTarget(null); setAssignError(null); } }}
        title={t('crewPlanning.assignCrew')}
        description={
          assignTarget
            ? `Trajet ${new Date(assignTarget.departureScheduled).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
            : undefined
        }
        size="md"
      >
        {assignTarget && (
          <AssignCrewForm
            eligibleStaff={eligibleStaff}
            onSubmit={handleAssignSubmit}
            onCancel={() => { setAssignTarget(null); setAssignError(null); }}
            busy={assignBusy}
            error={assignError}
          />
        )}
      </Dialog>
    </main>
  );
}
