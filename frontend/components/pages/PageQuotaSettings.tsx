/**
 * PageQuotaSettings — Module N PRD : observation des quotas runtime tenant.
 *
 * Affiche en temps réel l'usage des quotas Redis (sliding window) :
 *   - gps_update     : 1 req / 5s par trip
 *   - ws_connect     : 500 connexions / 60s par tenant
 *   - events_min     : 1000 events / 60s par tenant
 *   - api_req_min    : 300 req / 60s par tenant
 *
 * Endpoint : GET /api/tenants/:tid/quotas/usage
 * Permission : control.settings.manage.tenant
 *
 * Auto-refresh toutes les 10s pour suivre l'évolution.
 *
 * NOTE : la modification des limites passera par WorkflowConfig dans
 * une itération ultérieure (cf. backlog Module N).
 *
 * Qualité : i18n fr+en, WCAG AA, dark+light, responsive.
 */
import { useEffect } from 'react';
import { Activity, AlertCircle } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n, tm } from '../../lib/i18n/useI18n';
import { ErrorAlert } from '../ui/ErrorAlert';

type QuotaUsage = Record<string, number>;

const DEFAULT_LIMITS: Record<string, { max: number; windowSec: number; key: string }> = {
  gps_update:  { max: 1,    windowSec: 5,  key: 'quota.gps_update' },
  ws_connect:  { max: 500,  windowSec: 60, key: 'quota.ws_connect' },
  events_min:  { max: 1000, windowSec: 60, key: 'quota.events_min' },
  api_req_min: { max: 300,  windowSec: 60, key: 'quota.api_req_min' },
};

const REFRESH_INTERVAL_MS = 10_000;
const WARN_THRESHOLD_PCT  = 0.7;
const ALERT_THRESHOLD_PCT = 0.9;

export function PageQuotaSettings() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const canRead  = (user?.permissions ?? []).includes('control.settings.manage.tenant');

  const url = tenantId && canRead
    ? `/api/tenants/${tenantId}/quotas/usage`
    : null;

  const { data, loading, error, refetch } = useFetch<QuotaUsage>(url, [tenantId]);

  // Auto-refresh
  useEffect(() => {
    if (!url) return;
    const id = setInterval(refetch, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [url, refetch]);

  const T = {
    title:        t(tm('Quotas tenant', 'Tenant quotas')),
    subtitle:     t(tm('Observation runtime des quotas Redis (auto-refresh 10s)',
                       'Runtime quota observation (auto-refresh 10s)')),
    colName:      t(tm('Ressource', 'Resource')),
    colUsage:     t(tm('Usage', 'Usage')),
    colLimit:     t(tm('Limite', 'Limit')),
    colWindow:    t(tm('Fenêtre', 'Window')),
    colStatus:    t(tm('Statut', 'Status')),
    seconds:      t(tm('s', 's')),
    statusOk:     t(tm('Nominal', 'Nominal')),
    statusWarn:   t(tm('Surveillé', 'Watch')),
    statusAlert:  t(tm('Critique', 'Critical')),
    noData:       t(tm('Aucune donnée disponible', 'No data available')),
    notAuthorized: t(tm('Permission requise : control.settings.manage.tenant',
                        'Permission required: control.settings.manage.tenant')),
    headerNote:   t(tm('Les limites par défaut sont définies dans QuotaService. Ajustement via WorkflowConfig prochainement.',
                       'Default limits are defined in QuotaService. WorkflowConfig override coming soon.')),
  };

  const i18nResource = (key: string): string => {
    const map: Record<string, { fr: string; en: string }> = {
      gps_update:  { fr: 'Mises à jour GPS',     en: 'GPS updates' },
      ws_connect:  { fr: 'Connexions WebSocket', en: 'WebSocket connections' },
      events_min:  { fr: 'Événements / minute',   en: 'Events per minute' },
      api_req_min: { fr: 'Requêtes API / minute', en: 'API requests per minute' },
    };
    const entry = map[key];
    return entry ? t(tm(entry.fr, entry.en)) : key;
  };

  const statusFor = (usage: number, limit: number): { variant: string; label: string; pct: number } => {
    const pct = limit > 0 ? usage / limit : 0;
    if (pct >= ALERT_THRESHOLD_PCT) return { variant: 'alert', label: T.statusAlert, pct };
    if (pct >= WARN_THRESHOLD_PCT)  return { variant: 'warn',  label: T.statusWarn,  pct };
    return { variant: 'ok', label: T.statusOk, pct };
  };

  if (!canRead) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <ErrorAlert error={T.notAuthorized} icon className="mt-6" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" aria-labelledby="page-quotas-title">
      <header className="mb-6 flex items-start gap-3">
        <Activity className="w-6 h-6 text-blue-600 dark:text-blue-400 mt-0.5" aria-hidden />
        <div>
          <h1 id="page-quotas-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {T.title}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{T.subtitle}</p>
        </div>
      </header>

      {error && <ErrorAlert error={error} className="mb-4" />}

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <table className="w-full text-sm" aria-label={T.title}>
          <thead className="bg-slate-50 dark:bg-slate-800/40 text-left text-xs uppercase tracking-wide text-slate-600 dark:text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-3">{T.colName}</th>
              <th scope="col" className="px-4 py-3 text-right">{T.colUsage}</th>
              <th scope="col" className="px-4 py-3 text-right">{T.colLimit}</th>
              <th scope="col" className="px-4 py-3 text-right">{T.colWindow}</th>
              <th scope="col" className="px-4 py-3">{T.colStatus}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(DEFAULT_LIMITS).map(([key, cfg]) => {
              const usage  = data?.[key] ?? 0;
              const status = statusFor(usage, cfg.max);
              const barColor =
                status.variant === 'alert' ? 'bg-red-500' :
                status.variant === 'warn'  ? 'bg-amber-500' :
                                             'bg-green-500';
              const dotColor =
                status.variant === 'alert' ? 'bg-red-500' :
                status.variant === 'warn'  ? 'bg-amber-500' :
                                             'bg-green-500';
              return (
                <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {i18nResource(key)}
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{key}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {loading ? '…' : usage.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500 dark:text-slate-400">
                    {cfg.max.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">
                    {cfg.windowSec}{T.seconds}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${dotColor}`}
                        aria-hidden
                      />
                      <span className="text-xs">{status.label}</span>
                    </div>
                    <div
                      className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                      role="progressbar"
                      aria-valuenow={Math.round(status.pct * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${i18nResource(key)} : ${Math.round(status.pct * 100)}%`}
                    >
                      <div
                        className={`h-full ${barColor} transition-all duration-300`}
                        style={{ width: `${Math.min(100, status.pct * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
        <span>{T.headerNote}</span>
      </p>
    </div>
  );
}
