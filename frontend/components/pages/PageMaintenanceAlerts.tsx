/**
 * PageMaintenanceAlerts — « Alertes techniques »
 *
 * Dérive les alertes du croisement (bus, maintenance) :
 *   - Bus en statut MAINTENANCE → alerte critique
 *   - Bus sans seatLayout → alerte configuration
 *   - Fiche SCHEDULED dont la date est passée → alerte retard
 *   - Fiche SCHEDULED à venir < 72h → alerte imminente
 *
 * Pas d'endpoint dédié côté back — la dérivation est faite en front pour éviter
 * un aller-retour supplémentaire. À migrer vers un vrai feed temps-réel plus tard.
 */

import { useMemo } from 'react';
import { AlertTriangle, AlertCircle, Wrench, Grid3x3, Clock, Bus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Skeleton }                      from '../ui/Skeleton';
import { ErrorAlert }                    from '../ui/ErrorAlert';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusRow {
  id:          string;
  plateNumber: string;
  status:      'AVAILABLE' | 'IN_SERVICE' | 'MAINTENANCE' | 'OFFLINE';
  seatLayout?: unknown;
}

interface ReportRow {
  id:          string;
  busId:       string;
  type:        string;
  description: string;
  scheduledAt: string;
  status:      'SCHEDULED' | 'COMPLETED' | 'APPROVED';
  bus?:        { plateNumber: string };
}

type Severity = 'critical' | 'warning' | 'info';

interface AlertItem {
  id:       string;
  severity: Severity;
  icon:     React.ReactNode;
  title:    string;
  subject:  string;    // ex: plate number
  detail:   string;
  at?:      string;
}

const SEV_META: Record<Severity, { variant: 'danger' | 'warning' | 'info'; label: string }> = {
  critical: { variant: 'danger',  label: 'maintenanceAlerts.criticals' },
  warning:  { variant: 'warning', label: 'maintenanceAlerts.attention' },
  info:     { variant: 'info',    label: 'maintenanceAlerts.infos' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageMaintenanceAlerts() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const { data: buses, loading: loadingBuses, error: errBuses } = useFetch<BusRow[]>(
    tenantId ? `/api/tenants/${tenantId}/fleet/buses` : null, [tenantId],
  );
  const { data: reports, loading: loadingReports, error: errReports } = useFetch<ReportRow[]>(
    tenantId ? `/api/tenants/${tenantId}/garage/reports` : null, [tenantId],
  );
  // Rappels prédictifs (Sprint 7) — vidange/courroie/freins basés sur km + date
  // depuis TenantBusinessConfig.maintenanceIntervals. DUE = échu ; SOON = marge
  // d'anticipation atteinte.
  const { data: reminders } = useFetch<Array<{
    busId: string; plateNumber: string; type: string; label: string;
    dueAtKm?: number | null; dueAtDate?: string | null;
    kmRemaining?: number | null; daysRemaining?: number | null;
    status: 'DUE' | 'SOON' | 'OK' | 'UNKNOWN';
  }>>(tenantId ? `/api/tenants/${tenantId}/garage/reminders` : null, [tenantId]);

  const alerts = useMemo<AlertItem[]>(() => {
    const out: AlertItem[] = [];
    const now = Date.now();

    for (const b of buses ?? []) {
      if (b.status === 'MAINTENANCE') {
        out.push({
          id: `bus-maint-${b.id}`, severity: 'critical',
          icon: <Wrench className="w-4 h-4" />,
          title: t('maintenanceAlerts.vehicleWorkshop'),
          subject: b.plateNumber,
          detail: t('maintenanceAlerts.vehicleWorkDesc'),
        });
      }
      if (!b.seatLayout) {
        out.push({
          id: `bus-layout-${b.id}`, severity: 'warning',
          icon: <Grid3x3 className="w-4 h-4" />,
          title: t('maintenanceAlerts.missingSeatPlan'),
          subject: b.plateNumber,
          detail: t('maintenanceAlerts.missingSeatDesc'),
        });
      }
    }

    for (const r of reports ?? []) {
      if (r.status !== 'SCHEDULED') continue;
      const ts = new Date(r.scheduledAt).getTime();
      const plate = r.bus?.plateNumber ?? r.busId.slice(0, 8);
      if (ts < now) {
        out.push({
          id: `report-late-${r.id}`, severity: 'critical',
          icon: <Clock className="w-4 h-4" />,
          title: t('maintenanceAlerts.lateIntervention'),
          subject: plate,
          detail: `${r.type} — ${r.description}`,
          at: r.scheduledAt,
        });
      } else if (ts - now < 72 * 3600 * 1000) {
        out.push({
          id: `report-soon-${r.id}`, severity: 'warning',
          icon: <Clock className="w-4 h-4" />,
          title: t('maintenanceAlerts.soonIntervention'),
          subject: plate,
          detail: `${r.type} — ${r.description}`,
          at: r.scheduledAt,
        });
      }
    }

    // Rappels prédictifs (Sprint 7)
    for (const r of reminders ?? []) {
      if (r.status === 'DUE') {
        out.push({
          id: `reminder-due-${r.busId}-${r.type}`, severity: 'critical',
          icon: <Wrench className="w-4 h-4" />,
          title: t('maintenanceAlerts.predictiveDue'),
          subject: r.plateNumber,
          detail: `${r.label}${r.kmRemaining != null && r.kmRemaining < 0 ? ` · ${Math.abs(Math.round(r.kmRemaining))} km ${t('maintenanceAlerts.overdue')}` : ''}${r.daysRemaining != null && r.daysRemaining < 0 ? ` · ${Math.abs(r.daysRemaining)} ${t('maintenanceAlerts.daysOverdue')}` : ''}`,
          at: r.dueAtDate ?? undefined,
        });
      } else if (r.status === 'SOON') {
        out.push({
          id: `reminder-soon-${r.busId}-${r.type}`, severity: 'warning',
          icon: <Wrench className="w-4 h-4" />,
          title: t('maintenanceAlerts.predictiveSoon'),
          subject: r.plateNumber,
          detail: `${r.label}${r.kmRemaining != null ? ` · ${Math.round(r.kmRemaining)} km ${t('maintenanceAlerts.remaining')}` : ''}${r.daysRemaining != null ? ` · ${r.daysRemaining} ${t('maintenanceAlerts.daysRemaining')}` : ''}`,
          at: r.dueAtDate ?? undefined,
        });
      }
    }

    return out.sort((a, b) => {
      const order: Severity[] = ['critical', 'warning', 'info'];
      return order.indexOf(a.severity) - order.indexOf(b.severity);
    });
  }, [buses, reports, reminders, t]);

  const counts = useMemo(() => ({
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning:  alerts.filter(a => a.severity === 'warning').length,
    info:     alerts.filter(a => a.severity === 'info').length,
  }), [alerts]);

  const loading = loadingBuses || loadingReports;
  const error   = errBuses || errReports;

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('maintenanceAlerts.pageTitle')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('maintenanceAlerts.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('maintenanceAlerts.pageDesc')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <section aria-label={t('maintenanceAlerts.counters')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Counter label={t('maintenanceAlerts.criticals')} count={counts.critical} tone="danger" />
        <Counter label={t('maintenanceAlerts.attention')} count={counts.warning}  tone="warning" />
        <Counter label={t('maintenanceAlerts.infos')}     count={counts.info}     tone="info" />
      </section>

      <Card>
        <CardHeader heading={`${alerts.length} ${t('maintenanceAlerts.alerts')}`} />
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : alerts.length === 0 ? (
            <div className="py-16 text-center text-slate-500 dark:text-slate-400">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-slate-300" aria-hidden />
              <p className="font-medium">{t('maintenanceAlerts.allGood')}</p>
              <p className="text-sm mt-1">{t('maintenanceAlerts.noAnomaly')}</p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-slate-100 dark:divide-slate-800">
              {alerts.map(a => {
                const meta = SEV_META[a.severity];
                return (
                  <li key={a.id} className="px-6 py-4 flex items-start gap-3">
                    <div className={`p-2 rounded-lg shrink-0 ${
                      a.severity === 'critical' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                      : a.severity === 'warning' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                    }`} aria-hidden>
                      {a.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge size="sm" variant={meta.variant}>{t(meta.label)}</Badge>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.title}</span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Bus className="w-3 h-3" aria-hidden /> {a.subject}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{a.detail}</p>
                      {a.at && (
                        <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                          {new Date(a.at).toLocaleString('fr-FR')}
                        </p>
                      )}
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

function Counter({ label, count, tone }: { label: string; count: number; tone: 'danger' | 'warning' | 'info' }) {
  const toneClass = {
    danger:  'border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
    warning: 'border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
    info:    'border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300',
  }[tone];
  return (
    <div className={`border rounded-xl p-4 ${toneClass}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{count.toLocaleString('fr-FR')}</p>
    </div>
  );
}
