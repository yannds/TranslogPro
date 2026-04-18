/**
 * PageCustomerIncidents — Espace voyageur : liste + création d'un incident.
 *
 * Workflow :
 *   1. Liste des signalements de l'utilisateur (GET /incidents/mine/list)
 *   2. Bouton "Nouveau signalement" → Dialog avec formulaire
 *   3. Formulaire : type, sévérité, description, location (facultatif), tripId (optionnel)
 *
 * i18n 8 locales, light-mode first + dark:, WCAG (rôles, focus, aria).
 * Offline-compatible : lit via useOfflineList (cache IDB).
 */

import { useState } from 'react';
import {
  AlertTriangle, PlusCircle, Shield, MapPin, Clock, CheckCircle2, Loader2,
} from 'lucide-react';
import { useI18n }  from '../../lib/i18n/useI18n';
import { useAuth }  from '../../lib/auth/auth.context';
import { useOfflineList } from '../../lib/hooks/useOfflineList';
import { useOnline } from '../../lib/offline/online';
import { enqueueMutation } from '../../lib/offline/outbox';
import { apiPost, ApiError } from '../../lib/api';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import { cn } from '../../lib/utils';

const TYPES = ['ACCIDENT', 'BREAKDOWN', 'THEFT', 'DELAY', 'PASSENGER', 'INFRASTRUCTURE', 'OTHER'] as const;
type IncidentType = (typeof TYPES)[number];

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
type IncidentSeverity = (typeof SEVERITIES)[number];

interface IncidentRow {
  id:                  string;
  type:                IncidentType;
  severity:            IncidentSeverity;
  status:              string;
  description:         string;
  locationDescription: string | null;
  tripId:              string | null;
  busId:               string | null;
  isSos:               boolean;
  resolvedAt:          string | null;
  createdAt:           string;
}

const SEVERITY_VARIANT: Record<IncidentSeverity, 'default' | 'warning' | 'danger'> = {
  LOW:      'default',
  MEDIUM:   'warning',
  HIGH:     'danger',
  CRITICAL: 'danger',
};

const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  OPEN:       'warning',
  ASSIGNED:   'warning',
  IN_REVIEW:  'default',
  RESOLVED:   'success',
  DISMISSED:  'default',
};

export function PageCustomerIncidents() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const online = useOnline();

  const { items, loading, error, refetch, fromCache } = useOfflineList<IncidentRow>({
    table:    'passengers', // réutilise une table existante ; pas de collision car types distincts
    tenantId,
    url:      tenantId ? `/api/tenants/${tenantId}/incidents/mine/list` : null,
    toRecord: (row) => ({ id: `inc:${row.id}`, tripId: row.tripId ?? null }),
    cachedFilter: (r) => typeof r.id === 'string' && r.id.startsWith('inc:'),
    deps:     [tenantId],
  });

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4" role="region" aria-label={t('customerIncidents.title')}>
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/40">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
              {t('customerIncidents.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('customerIncidents.subtitle')}
            </p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          variant="default"
          leftIcon={<PlusCircle className="w-4 h-4" aria-hidden />}
          aria-label={t('customerIncidents.newBtn')}
        >
          {t('customerIncidents.newBtn')}
        </Button>
      </header>

      {fromCache && (
        <div
          role="note"
          className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          {t('offline.cachedData')}
        </div>
      )}

      <ErrorAlert error={error} icon />

      {loading && (
        <div className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          {t('common.loading')}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <Shield className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2" aria-hidden />
          <p className="text-slate-600 dark:text-slate-400">{t('customerIncidents.emptyHint')}</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="space-y-3" aria-label={t('customerIncidents.listAria')}>
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge variant={SEVERITY_VARIANT[it.severity]}>
                      {t(`customerIncidents.severity_${it.severity}`)}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[it.status] ?? 'default'}>
                      {t(`customerIncidents.status_${it.status}`)}
                    </Badge>
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t(`customerIncidents.type_${it.type}`)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {it.description}
                  </p>
                  {it.locationDescription && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" aria-hidden /> {it.locationDescription}
                    </p>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 shrink-0 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden />
                  {new Date(it.createdAt).toLocaleDateString(undefined, {
                    day: '2-digit', month: 'short', year: 'numeric',
                  })}
                </div>
              </div>
              {it.resolvedAt && (
                <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" aria-hidden />
                  {t('customerIncidents.resolvedOn', {
                    date: new Date(it.resolvedAt).toLocaleDateString(),
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <NewIncidentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantId={tenantId}
        online={online}
        onCreated={() => { setCreateOpen(false); refetch(); }}
      />
    </div>
  );
}

// ── Dialog création ─────────────────────────────────────────────────────────

interface NewIncidentDialogProps {
  open:     boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  online:   boolean;
  onCreated: () => void;
}

function NewIncidentDialog({ open, onOpenChange, tenantId, online, onCreated }: NewIncidentDialogProps) {
  const { t } = useI18n();
  const [type,        setType]        = useState<IncidentType>('PASSENGER');
  const [severity,    setSeverity]    = useState<IncidentSeverity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [location,    setLocation]    = useState('');
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  async function submit() {
    if (description.trim().length < 10) {
      setErr(t('customerIncidents.errorDescription'));
      return;
    }
    setBusy(true); setErr(null);
    const body = {
      type,
      severity,
      description: description.trim(),
      locationDescription: location.trim() || undefined,
      isSos: false,
    };
    try {
      if (!online) {
        await enqueueMutation({
          tenantId,
          kind: 'incident.create.mine',
          method: 'POST',
          url: `/api/tenants/${tenantId}/incidents/mine`,
          body,
          context: body,
        });
      } else {
        await apiPost(`/api/tenants/${tenantId}/incidents/mine`, body);
      }
      setType('PASSENGER');
      setSeverity('MEDIUM');
      setDescription('');
      setLocation('');
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setErr(t('customerIncidents.errorRateLimit'));
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('customerIncidents.newTitle')}
      description={t('customerIncidents.newDesc')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy} loading={busy}>
            {online ? t('customerIncidents.submit') : t('customerIncidents.submitQueued')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <ErrorAlert error={err} icon />

        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">{t('customerIncidents.typeLabel')}</span>
          <select
            value={type}
            onChange={e => setType(e.target.value as IncidentType)}
            className={inputClass}
            aria-label={t('customerIncidents.typeLabel')}
          >
            {TYPES.map(v => (
              <option key={v} value={v}>{t(`customerIncidents.type_${v}`)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">{t('customerIncidents.severityLabel')}</span>
          <div className="mt-1 grid grid-cols-4 gap-1" role="radiogroup" aria-label={t('customerIncidents.severityLabel')}>
            {SEVERITIES.map(v => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={severity === v}
                onClick={() => setSeverity(v)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium border',
                  severity === v
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700',
                )}
              >
                {t(`customerIncidents.severity_${v}`)}
              </button>
            ))}
          </div>
        </label>

        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">
            {t('customerIncidents.descriptionLabel')} <span aria-hidden className="text-red-600">*</span>
          </span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            className={inputClass}
            rows={4}
            minLength={10}
            maxLength={1_000}
            required
            aria-required="true"
            aria-describedby="desc-hint"
          />
          <p id="desc-hint" className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('customerIncidents.descriptionHint')} — {description.length}/1000
          </p>
        </label>

        <label className="block">
          <span className="text-sm text-slate-700 dark:text-slate-300">{t('customerIncidents.locationLabel')}</span>
          <input
            type="text"
            value={location}
            onChange={e => setLocation(e.target.value)}
            className={inputClass}
            placeholder={t('customerIncidents.locationPlaceholder')}
          />
        </label>

        {!online && (
          <p
            role="note"
            className="text-xs text-amber-700 dark:text-amber-300 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2"
          >
            {t('customerIncidents.offlineHint')}
          </p>
        )}
      </div>
    </Dialog>
  );
}
