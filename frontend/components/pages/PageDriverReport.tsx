/**
 * PageDriverReport — « Rapport de voyage »
 *
 * Formulaire de rapport chauffeur en fin de trajet, reposant sur l'API incidents.
 * Si un trajet actif existe, tripId et busId sont pré-remplis automatiquement.
 *
 * API :
 *   GET  /api/tenants/:tid/flight-deck/active-trip   → trajet actif (id, bus.id, bus.plateNumber)
 *   POST /api/tenants/:tid/incidents                  → création incident / rapport
 */

import { useState, type FormEvent } from 'react';
import { FileText, CheckCircle2 } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                       from '../../lib/i18n/useI18n';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost }                       from '../../lib/api';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveTrip {
  id:  string;
  bus: { id: string; plateNumber: string };
}

const INCIDENT_TYPES = [
  'ACCIDENT',
  'BREAKDOWN',
  'THEFT',
  'DELAY',
  'PASSENGER',
  'INFRASTRUCTURE',
  'OTHER',
] as const;

// ─── i18n ────────────────────────────────────────────────────────────────────

const INCIDENT_TYPE_LABELS: Record<string, string> = {
  ACCIDENT:       'driverReport.typeAccident',
  BREAKDOWN:      'driverReport.typeBreakdown',
  THEFT:          'driverReport.typeTheft',
  DELAY:          'driverReport.typeDelay',
  PASSENGER:      'driverReport.typePassenger',
  INFRASTRUCTURE: 'driverReport.typeInfrastructure',
  OTHER:          'driverReport.typeOther',
};

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const SEVERITY_LABELS: Record<string, string> = {
  LOW:      'driverReport.sevLow',
  MEDIUM:   'driverReport.sevMedium',
  HIGH:     'driverReport.sevHigh',
  CRITICAL: 'driverReport.sevCritical',
};

interface FormValues {
  type:                string;
  severity:            string;
  description:         string;
  locationDescription: string;
}

const EMPTY_FORM: FormValues = {
  type: 'OTHER',
  severity: 'LOW',
  description: '',
  locationDescription: '',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageDriverReport() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  const { data: activeTrip, loading: tripLoading } = useFetch<ActiveTrip>(
    tenantId ? `${base}/flight-deck/active-trip` : null, [tenantId],
  );

  const [form, setForm]       = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const patch = (p: Partial<FormValues>) => setForm(prev => ({ ...prev, ...p }));

  const openConfirm = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setConfirm(true);
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`${base}/incidents`, {
        type:                form.type,
        severity:            form.severity,
        description:         form.description.trim(),
        locationDescription: form.locationDescription.trim() || undefined,
        tripId:              activeTrip?.id ?? undefined,
        busId:               activeTrip?.bus?.id ?? undefined,
        isSos:               false,
      });
      setConfirm(false);
      setSuccess(true);
      setForm(EMPTY_FORM);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Rapport de voyage">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverReport.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {tripLoading
              ? t('driverReport.loadingTrip')
              : activeTrip
                ? `${t('driverReport.activeTrip')} — bus ${activeTrip.bus.plateNumber}`
                : t('driverReport.noActiveTrip')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      {/* Success feedback */}
      {success && (
        <div
          className="flex items-center gap-3 rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 p-4"
          role="status"
        >
          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              {t('driverReport.successTitle')}
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              {t('driverReport.successMsg')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setSuccess(false)}
          >
            {t('driverReport.newReport')}
          </Button>
        </div>
      )}

      {/* Form */}
      {!success && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          <form onSubmit={openConfirm} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('driverReport.incidentType')} <span aria-hidden className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.type}
                  onChange={e => patch({ type: e.target.value })}
                  className={inp}
                  disabled={busy}
                >
                  {INCIDENT_TYPES.map(itype => (
                    <option key={itype} value={itype}>{t(INCIDENT_TYPE_LABELS[itype])}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('driverReport.gravityLabel')} <span aria-hidden className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.severity}
                  onChange={e => patch({ severity: e.target.value })}
                  className={inp}
                  disabled={busy}
                >
                  {SEVERITIES.map(sv => (
                    <option key={sv} value={sv}>{t(SEVERITY_LABELS[sv])}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverReport.descriptionLabel')} <span aria-hidden className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={4}
                value={form.description}
                onChange={e => patch({ description: e.target.value })}
                className={inp}
                disabled={busy}
                placeholder={t('driverReport.descPlaceholder')}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('driverReport.locationLabel')}
              </label>
              <input
                type="text"
                value={form.locationDescription}
                onChange={e => patch({ locationDescription: e.target.value })}
                className={inp}
                disabled={busy}
                placeholder="Ex : PK 42, sortie Douala-Yaoundé"
              />
            </div>

            {activeTrip && (
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-xs text-slate-500 dark:text-slate-400">
                Trajet : <span className="font-mono">{activeTrip.id.slice(0, 8)}</span>
                {' '}&middot;{' '}
                Bus : <span className="font-semibold text-slate-700 dark:text-slate-300">{activeTrip.bus.plateNumber}</span>
                {' '}{t('driverReport.autoFilled')}
              </div>
            )}

            <FormFooter
              onCancel={() => { setForm(EMPTY_FORM); setError(null); }}
              busy={busy}
              submitLabel={t('driverReport.sendReport')}
              pendingLabel={t('driverReport.sending')}
            />
          </form>
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog
        open={confirm}
        onOpenChange={o => { if (!o) setConfirm(false); }}
        title={t('driverReport.confirmTitle')}
        description={`${t(INCIDENT_TYPE_LABELS[form.type])} (${t(SEVERITY_LABELS[form.severity])})`}
        footer={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>
              {t('driverReport.cancelBtn')}
            </Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy ? t('driverReport.sending') : t('driverReport.confirmBtn')}
            </Button>
          </div>
        }
      >
        <ErrorAlert error={error} />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {form.description}
        </p>
        {form.locationDescription && (
          <p className="text-xs text-slate-500 mt-1">
            {t('driverReport.locationHint')} : {form.locationDescription}
          </p>
        )}
      </Dialog>
    </main>
  );
}
