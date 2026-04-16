/**
 * PageTripDelays — « Retards & Alertes » (module Trajets & Planning)
 *
 * Vigie opérationnelle : tous les trajets en retard (status IN_PROGRESS_DELAYED,
 * ou heure de départ dépassée avec status PLANNED/OPEN), triés par retard décroissant.
 *
 * Granularité d'alerte :
 *   ≥ 60 min  → critique (rouge)
 *   ≥ 15 min  → modéré  (ambre)
 *   < 15 min  → léger   (gris)
 *
 * WCAG (aria-live pour updates) · dark mode · responsive.
 */

import { useMemo } from 'react';
import {
  AlertTriangle, Clock, MapPin, Bus, CheckCircle2, Timer,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useI18n }       from '../../lib/i18n/useI18n';
import { useFetch }      from '../../lib/hooks/useFetch';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }         from '../ui/Badge';
import { Skeleton }      from '../ui/Skeleton';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { cn }            from '../../lib/utils';
import {
  type TripRow,
  routeLabelOf, tripStatusLabel, tripStatusBadgeVariant,
  isTripDelayed, delayMinutes,
} from './trips/shared';

// ─── i18n ─────────────────────────────────────────────────────────────────────

// T block removed — using string-key-based i18n with namespace 'tripDelays'

type Severity = 'critical' | 'moderate' | 'light';

function severityOf(mn: number): Severity {
  if (mn >= 60) return 'critical';
  if (mn >= 15) return 'moderate';
  return 'light';
}

function formatDelayHuman(mn: number): string {
  if (mn < 60) return `${mn} min`;
  const h = Math.floor(mn / 60);
  const r = mn % 60;
  return r === 0 ? `${h} h` : `${h} h ${r.toString().padStart(2, '0')}`;
}

export function PageTripDelays() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const { data: trips, loading, error } = useFetch<TripRow[]>(
    tenantId ? `/api/tenants/${tenantId}/trips` : null,
    [tenantId],
  );

  const now = new Date();

  const SEVERITY_META: Record<Severity, { label: string; cls: string; badge: 'danger' | 'warning' | 'default' }> = {
    critical: { label: t('tripDelays.criticalLabel'), cls: 'border-red-300 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20', badge: 'danger'  },
    moderate: { label: t('tripDelays.moderateLabel'), cls: 'border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20', badge: 'warning' },
    light:    { label: t('tripDelays.lightLabel'),    cls: 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900', badge: 'default' },
  };

  const delayed = useMemo(() => {
    return (trips ?? [])
      .filter(t => isTripDelayed(t, now))
      .map(t => ({ trip: t, minutes: delayMinutes(t, now) }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [trips, now]);

  const kpi = useMemo(() => {
    let critical = 0, moderate = 0, light = 0;
    delayed.forEach(d => {
      const s = severityOf(d.minutes);
      if (s === 'critical') critical += 1;
      else if (s === 'moderate') moderate += 1;
      else light += 1;
    });
    return { total: delayed.length, critical, moderate, light };
  }, [delayed]);

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('tripDelays.pageTitle')}>
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('tripDelays.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('tripDelays.pageDesc')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      {/* KPIs */}
      <section aria-label={t('tripDelays.pageTitle')} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SevKpi label={t('tripDelays.totalDelays')}  value={kpi.total}    variant="total" />
        <SevKpi label={t('tripDelays.criticalKpi')}  value={kpi.critical} variant="critical" />
        <SevKpi label={t('tripDelays.moderateKpi')}  value={kpi.moderate} variant="moderate" />
        <SevKpi label={t('tripDelays.lightKpi')}     value={kpi.light}    variant="light" />
      </section>

      {/* Liste live */}
      <Card>
        <CardHeader
          heading={t('tripDelays.delayedTrips')}
          description={t('tripDelays.sortDesc')}
        />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : delayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
              <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-500" aria-hidden />
              <p className="font-medium">{t('tripDelays.noDelay')}</p>
              <p className="text-sm mt-1">{t('tripDelays.allOnTime')}</p>
            </div>
          ) : (
            <ul role="list" className="p-4 space-y-3" aria-live="polite">
              {delayed.map(({ trip, minutes }) => {
                const sev  = severityOf(minutes);
                const meta = SEVERITY_META[sev];
                return (
                  <li
                    key={trip.id}
                    className={cn(
                      'rounded-lg border p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6',
                      meta.cls,
                    )}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Timer className="w-5 h-5 mt-0.5 text-slate-500 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-teal-500 shrink-0" aria-hidden />
                          <span className="truncate">{routeLabelOf(trip)}</span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" aria-hidden />
                            {t('tripDelays.scheduledDep')} {new Date(trip.departureScheduled).toLocaleString('fr-FR', {
                              weekday: 'short', day: '2-digit', month: 'short',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          {trip.bus?.plateNumber && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="inline-flex items-center gap-1">
                                <Bus className="w-3 h-3" aria-hidden />
                                {trip.bus.plateNumber}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <Badge variant={tripStatusBadgeVariant(trip.status)} size="sm">
                        {tripStatusLabel(trip.status)}
                      </Badge>
                      <Badge variant={meta.badge} size="sm">{meta.label}</Badge>
                      <span
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          sev === 'critical' ? 'text-red-600 dark:text-red-400'
                          : sev === 'moderate' ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-400',
                        )}
                        aria-label={`${t('tripDelays.delayOf')} ${formatDelayHuman(minutes)}`}
                      >
                        +{formatDelayHuman(minutes)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

// ─── KPI par sévérité ─────────────────────────────────────────────────────────

function SevKpi({
  label, value, variant,
}: {
  label: string; value: number;
  variant: 'total' | 'critical' | 'moderate' | 'light';
}) {
  const map = {
    total:    { tone: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300', text: 'text-slate-900 dark:text-slate-50' },
    critical: { tone: 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400',       text: value > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-50' },
    moderate: { tone: 'bg-amber-50 dark:bg-amber-900/20 text-amber-500 dark:text-amber-400', text: value > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-50' },
    light:    { tone: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400', text: 'text-slate-900 dark:text-slate-50' },
  };
  const m = map[variant];
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3"
      aria-label={`${label}: ${value}`}
    >
      <div className={cn('p-2.5 rounded-lg shrink-0', m.tone)} aria-hidden>
        <AlertTriangle className="w-5 h-5" />
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className={cn('text-xl font-bold tabular-nums', m.text)}>{value}</p>
      </div>
    </article>
  );
}
