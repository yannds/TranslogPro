/**
 * PageDriverTrip — « Mon trajet » (vue chauffeur)
 *
 * Affiche le trajet actif du chauffeur connecté :
 *   - KPIs : statut, plaque véhicule, passagers, colis
 *   - Détails route (origine → destination), heure de départ, bus
 *   - Checklist pré-départ avec complétion item par item
 *   - Résumé passagers (compteur)
 *
 * Permission d'accès : DRIVER (gatée par la nav).
 * WCAG 2.1 AA · Dark mode · responsive.
 */

import { useState } from 'react';
import {
  MapPin, Bus, Users, Package, Clock, CheckCircle2,
  Circle, ArrowRight, Route as RouteIcon,
} from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiPatch }   from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }      from '../ui/Badge';
import { Skeleton }   from '../ui/Skeleton';
import { Button }     from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { cn }         from '../../lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ActiveTrip {
  id: string;
  status: string;
  reference?: string | null;
  departureScheduled?: string | null;
  route: {
    id: string;
    name?: string | null;
    origin?: { id: string; name: string } | null;
    destination?: { id: string; name: string } | null;
  } | null;
  bus: { id: string; plateNumber: string; model?: string | null } | null;
  travelers: { id: string }[];
  shipments: { id: string; parcels: { id: string }[] }[];
}

interface ChecklistItem {
  id: string;
  label?: string | null;
  completedAt: string | null;
  completedById: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PLANNED:             'driverTrip.statusPlanned',
  OPEN:                'driverTrip.statusOpen',
  BOARDING:            'driverTrip.statusBoarding',
  IN_PROGRESS:         'driverTrip.statusInProgress',
  IN_PROGRESS_DELAYED: 'driverTrip.statusDelayed',
  COMPLETED:           'driverTrip.statusCompleted',
  CANCELLED:           'driverTrip.statusCancelled',
};

const STATUS_BADGE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  PLANNED:             'neutral',
  OPEN:                'info',
  BOARDING:            'info',
  IN_PROGRESS:         'success',
  IN_PROGRESS_DELAYED: 'danger',
  COMPLETED:           'success',
  CANCELLED:           'neutral',
};

function statusLabel(s: string, t: (key: string | Record<string, string | undefined>) => string) { return STATUS_LABELS[s] ? t(STATUS_LABELS[s]) : s; }
function statusBadge(s: string) { return STATUS_BADGE[s] ?? 'neutral'; }

function formatHm(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function countParcels(trip: ActiveTrip): number {
  return trip.shipments.reduce((sum, s) => sum + s.parcels.length, 0);
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function PageDriverTrip() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const base = `/api/tenants/${tenantId}/flight-deck`;

  const { data: trip, loading, error } = useFetch<ActiveTrip | null>(
    tenantId ? `${base}/active-trip` : null,
    [tenantId],
  );

  const { data: checklist, loading: loadingChecklist, refetch: refetchChecklist } =
    useFetch<ChecklistItem[]>(
      trip?.id ? `${base}/trips/${trip.id}/checklist` : null,
      [tenantId, trip?.id],
    );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Complete checklist item ───────────────────────────────────────────────
  const handleComplete = async (item: ChecklistItem) => {
    setBusyId(item.id);
    setActionError(null);
    try {
      await apiPatch(`/api/tenants/${tenantId}/flight-deck/checklist/${item.id}/complete`, {});
      refetchChecklist();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t('driverTrip.errorComplete'));
    } finally {
      setBusyId(null);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const passengersCount = trip?.travelers.length ?? 0;
  const parcelsCount    = trip ? countParcels(trip) : 0;
  const checklistDone   = (checklist ?? []).filter(c => c.completedAt).length;
  const checklistTotal  = (checklist ?? []).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="p-6 space-y-6" role="main" aria-label="Mon trajet">
      {/* En-tête */}
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <RouteIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverTrip.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverTrip.pageSubtitle')}
          </p>
        </div>
      </header>

      <ErrorAlert error={error} icon />
      <ErrorAlert error={actionError} icon />

      {/* Loading */}
      {loading && (
        <div className="space-y-4" aria-busy="true">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      )}

      {/* Empty state */}
      {!loading && !trip && (
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status">
              <RouteIcon className="w-10 h-10 mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="font-medium">{t('driverTrip.noActiveTrip')}</p>
              <p className="text-sm mt-1">{t('driverTrip.noActiveTripMsg')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active trip */}
      {!loading && trip && (
        <>
          {/* KPIs */}
          <section aria-label="Indicateurs trajet" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Kpi
              label={t('driverTrip.status')}
              value={statusLabel(trip.status, t)}
              icon={<CheckCircle2 className="w-5 h-5" />}
              tone={statusBadge(trip.status)}
            />
            <Kpi
              label={t('driverTrip.vehicle')}
              value={trip.bus?.plateNumber ?? '—'}
              icon={<Bus className="w-5 h-5" />}
              tone="info"
            />
            <Kpi
              label={t('driverTrip.passengers')}
              value={String(passengersCount)}
              icon={<Users className="w-5 h-5" />}
              tone="neutral"
            />
            <Kpi
              label={t('driverTrip.parcels')}
              value={String(parcelsCount)}
              icon={<Package className="w-5 h-5" />}
              tone="neutral"
            />
          </section>

          {/* Route & bus info */}
          <Card>
            <CardHeader
              heading={trip.reference ? `${t('driverTrip.pageTitle')} ${trip.reference}` : t('driverTrip.tripDetails')}
              description={t('driverTrip.tripDetailsDesc')}
            />
            <CardContent>
              <div className="space-y-4">
                {/* Route */}
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {trip.route?.origin?.name ?? '—'}
                  </span>
                  <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {trip.route?.destination?.name ?? '—'}
                  </span>
                  {trip.route?.name && (
                    <Badge variant="outline" size="sm">{trip.route.name}</Badge>
                  )}
                </div>

                {/* Departure */}
                {trip.departureScheduled && (
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <span className="text-slate-700 dark:text-slate-300">
                      {t('driverTrip.scheduledDep')} : <span className="font-medium tabular-nums">{formatHm(trip.departureScheduled)}</span>
                    </span>
                  </div>
                )}

                {/* Bus info */}
                {trip.bus && (
                  <div className="flex items-center gap-3 text-sm">
                    <Bus className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                    <span className="text-slate-700 dark:text-slate-300">
                      {trip.bus.plateNumber}
                      {trip.bus.model && <span className="ml-2 text-slate-500">({trip.bus.model})</span>}
                    </span>
                  </div>
                )}

                {/* Passengers summary */}
                <div className="flex items-center gap-3 text-sm">
                  <Users className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
                  <span className="text-slate-700 dark:text-slate-300">
                    {passengersCount} {t('driverTrip.registered')}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Checklist */}
          <Card>
            <CardHeader
              heading={t('driverTrip.checklist')}
              description={
                checklistTotal > 0
                  ? `${checklistDone} / ${checklistTotal} ${t('driverTrip.completed')}`
                  : t('driverTrip.noChecklist')
              }
            />
            <CardContent className="p-0">
              {loadingChecklist ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !checklist || checklist.length === 0 ? (
                <div className="flex flex-col items-center py-12 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-8 h-8 mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="text-sm">{t('driverTrip.noChecklistTrip')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {checklist.map(item => {
                    const done = !!item.completedAt;
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          'flex items-center justify-between px-6 py-3 gap-4',
                          done && 'bg-emerald-50/50 dark:bg-emerald-900/10',
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {done ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" aria-hidden />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0" aria-hidden />
                          )}
                          <span
                            className={cn(
                              'text-sm truncate',
                              done
                                ? 'text-slate-500 dark:text-slate-400 line-through'
                                : 'text-slate-900 dark:text-slate-100 font-medium',
                            )}
                          >
                            {item.label ?? t('driverTrip.noLabel')}
                          </span>
                        </div>

                        {done ? (
                          <Badge variant="success" size="sm">{t('driverTrip.done')}</Badge>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => handleComplete(item)}
                            disabled={busyId === item.id}
                            aria-label={`Compléter : ${item.label ?? 'élément'}`}
                          >
                            {busyId === item.id ? t('driverTrip.completing') : t('driverTrip.complete')}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

// ─── Composant KPI local ────────────────────────────────────────────────────

function Kpi({
  label, value, icon, tone,
}: {
  label: string; value: string; icon: React.ReactNode;
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
