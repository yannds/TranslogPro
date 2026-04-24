/**
 * PageTripSafetyAlerts — feed des alertes sécurité trip (immuables, QHSE).
 *
 * Alertes émises par le briefing pré-voyage (item mandatory KO, repos
 * conducteur insuffisant) ou d'autres sources QHSE. Liste filtrée par
 * sévérité/source/statut. Résolution avec note de clôture (immuable).
 *
 * Accessibilité : WCAG 2.1 AA (role=status, aria-live).
 * Dark mode : Tailwind dark:. Light par défaut.
 * i18n : namespace `safetyAlerts.*` + `common.*`.
 */

import { useState, useMemo, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Shield, Clock } from 'lucide-react';
import { useAuth }     from '../../lib/auth/auth.context';
import { useI18n }     from '../../lib/i18n/useI18n';
import { useFetch }    from '../../lib/hooks/useFetch';
import { apiPatch }    from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }       from '../ui/Badge';
import { Button }      from '../ui/Button';
import { Dialog }      from '../ui/Dialog';
import { ErrorAlert }  from '../ui/ErrorAlert';
import { FormFooter }  from '../ui/FormFooter';
import { Skeleton }    from '../ui/Skeleton';
import { inputClass }  from '../ui/inputClass';

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
type Source   = 'BRIEFING' | 'INCIDENT' | 'COMPLIANCE';
type ResolvedFilter = 'open' | 'closed' | 'all';

interface SafetyAlert {
  id:             string;
  tripId:         string;
  severity:       Severity;
  source:         Source;
  code:           string;
  payload:        Record<string, unknown>;
  resolvedAt:     string | null;
  resolvedById:   string | null;
  resolutionNote: string | null;
  createdAt:      string;
}

export function PageTripSafetyAlerts() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [severity, setSeverity] = useState<'' | Severity>('');
  const [source,   setSource]   = useState<'' | Source>('');
  const [resolved, setResolved] = useState<ResolvedFilter>('open');
  const [openAlert, setOpenAlert] = useState<SafetyAlert | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (severity) p.set('severity', severity);
    if (source)   p.set('source',   source);
    if (resolved === 'open')   p.set('resolved', 'false');
    if (resolved === 'closed') p.set('resolved', 'true');
    p.set('limit', '200');
    return p.toString();
  }, [severity, source, resolved]);

  const url = tenantId ? `/api/tenants/${tenantId}/crew-briefing/safety-alerts?${qs}` : null;
  const { data, loading, error, refetch } = useFetch<SafetyAlert[]>(url, [qs, tenantId]);

  if (loading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  if (error)   return <div className="p-6"><ErrorAlert error={error} /></div>;

  const alerts = data ?? [];

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Shield className="w-6 h-6 text-red-600 dark:text-red-400" aria-hidden="true" />
          {t('safetyAlerts.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('safetyAlerts.subtitle')}
        </p>
      </header>

      {/* Filtres */}
      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t('safetyAlerts.filterSeverity')}</span>
            <select value={severity} onChange={e => setSeverity(e.target.value as Severity | '')} className={inputClass}>
              <option value="">—</option>
              <option value="INFO">{t('safetyAlerts.severity.INFO')}</option>
              <option value="WARNING">{t('safetyAlerts.severity.WARNING')}</option>
              <option value="CRITICAL">{t('safetyAlerts.severity.CRITICAL')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t('safetyAlerts.filterSource')}</span>
            <select value={source} onChange={e => setSource(e.target.value as Source | '')} className={inputClass}>
              <option value="">—</option>
              <option value="BRIEFING">{t('safetyAlerts.source.BRIEFING')}</option>
              <option value="INCIDENT">{t('safetyAlerts.source.INCIDENT')}</option>
              <option value="COMPLIANCE">{t('safetyAlerts.source.COMPLIANCE')}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-700 dark:text-gray-300">{t('safetyAlerts.filterResolved')}</span>
            <select value={resolved} onChange={e => setResolved(e.target.value as ResolvedFilter)} className={inputClass}>
              <option value="open">{t('safetyAlerts.resolvedFilter.open')}</option>
              <option value="closed">{t('safetyAlerts.resolvedFilter.closed')}</option>
              <option value="all">{t('safetyAlerts.resolvedFilter.all')}</option>
            </select>
          </label>
        </CardContent>
      </Card>

      {/* Liste */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {alerts.length} {t('safetyAlerts.title').toLowerCase()}
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400" role="status">
              {t('safetyAlerts.noAlerts')}
            </div>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {alerts.map(a => (
                <li key={a.id} className="p-4 flex items-start gap-4">
                  <AlertIcon severity={a.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <SeverityBadge severity={a.severity} />
                      <Badge variant="default">{t(`safetyAlerts.source.${a.source}`)}</Badge>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {t(`safetyAlerts.code.${a.code}`) || a.code}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {t('safetyAlerts.colCreatedAt')}: {new Date(a.createdAt).toLocaleString()}
                      {' · '}{t('safetyAlerts.colTrip')}: <code>{a.tripId}</code>
                    </p>
                    {a.resolvedAt && (
                      <p className="text-xs text-green-700 dark:text-green-400 mt-1 flex items-center gap-2">
                        <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                        {t('safetyAlerts.colResolvedAt')}: {new Date(a.resolvedAt).toLocaleString()}
                        {a.resolutionNote && ` — "${a.resolutionNote}"`}
                      </p>
                    )}
                  </div>
                  {!a.resolvedAt && (
                    <Button size="sm" onClick={() => setOpenAlert(a)}>
                      {t('safetyAlerts.resolve')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!openAlert} onOpenChange={(v) => { if (!v) setOpenAlert(null); }} title={t('safetyAlerts.resolveTitle')}>
        {openAlert && (
          <ResolveForm
            baseUrl={`/api/tenants/${tenantId}/crew-briefing`}
            alert={openAlert}
            userId={user?.id ?? ''}
            onDone={() => { setOpenAlert(null); refetch(); }}
            onCancel={() => setOpenAlert(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

// ─── Helpers visuels ──────────────────────────────────────────────────────

function AlertIcon({ severity }: { severity: Severity }) {
  const color =
    severity === 'CRITICAL' ? 'text-red-600 dark:text-red-400' :
    severity === 'WARNING'  ? 'text-amber-600 dark:text-amber-400' :
                              'text-blue-600 dark:text-blue-400';
  return <AlertTriangle className={`w-5 h-5 shrink-0 ${color}`} aria-hidden="true" />;
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  const variant =
    severity === 'CRITICAL' ? 'danger' :
    severity === 'WARNING'  ? 'warning' : 'default';
  return <Badge variant={variant as any}>{t(`safetyAlerts.severity.${severity}`)}</Badge>;
}

// ─── Formulaire résolution ────────────────────────────────────────────────

function ResolveForm(props: {
  baseUrl: string;
  alert:   SafetyAlert;
  userId:  string;
  onDone:  () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPatch(`${props.baseUrl}/safety-alerts/${props.alert.id}/resolve`, {
        resolvedById:   props.userId,
        resolutionNote: note || undefined,
      });
      props.onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('safetyAlerts.resolveDesc')}</p>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('safetyAlerts.resolutionNote')}
        </span>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} className={inputClass} />
      </label>
      {err && <ErrorAlert error={err} />}
      <FormFooter
        submitLabel={t('safetyAlerts.resolve')}
        pendingLabel={t('safetyAlerts.resolving')}
        busy={saving}
        onCancel={props.onCancel}
      />
    </form>
  );
}
