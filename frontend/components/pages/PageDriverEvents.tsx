/**
 * PageDriverEvents — Journal de bord / signalement d'incidents (vue chauffeur)
 *
 * Permet au chauffeur de signaler un incident sur son trajet actif
 * via POST /incidents. Bouton SOS pré-remplit severity=CRITICAL + isSos=true.
 */

import { useState, type FormEvent } from 'react';
import { AlertTriangle, ShieldAlert, Plus, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveTrip {
  id: string;
  busId?: string | null;
  reference?: string | null;
}

type IncidentType = 'ACCIDENT' | 'BREAKDOWN' | 'THEFT' | 'DELAY' | 'PASSENGER' | 'INFRASTRUCTURE' | 'OTHER';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const INCIDENT_TYPES: { value: IncidentType; labelKey: string }[] = [
  { value: 'ACCIDENT',       labelKey: 'driverEvents.typeAccident' },
  { value: 'BREAKDOWN',      labelKey: 'driverEvents.typeBreakdown' },
  { value: 'THEFT',          labelKey: 'driverEvents.typeTheft' },
  { value: 'DELAY',          labelKey: 'driverEvents.typeDelay' },
  { value: 'PASSENGER',      labelKey: 'driverEvents.typePassenger' },
  { value: 'INFRASTRUCTURE', labelKey: 'driverEvents.typeInfrastructure' },
  { value: 'OTHER',          labelKey: 'driverEvents.typeOther' },
];

const SEVERITIES: { value: Severity; labelKey: string }[] = [
  { value: 'LOW',      labelKey: 'driverEvents.sevLow' },
  { value: 'MEDIUM',   labelKey: 'driverEvents.sevMedium' },
  { value: 'HIGH',     labelKey: 'driverEvents.sevHigh' },
  { value: 'CRITICAL', labelKey: 'driverEvents.sevCritical' },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function PageDriverEvents() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: activeTrip, loading: loadingTrip } = useFetch<ActiveTrip>(
    tenantId ? `/api/tenants/${tenantId}/flight-deck/active-trip` : null,
    [tenantId],
  );

  // Dialog state
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IncidentType>('OTHER');
  const [severity, setSeverity] = useState<Severity>('MEDIUM');
  const [description, setDescription] = useState('');
  const [lieu, setLieu] = useState('');
  const [isSos, setIsSos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetForm = () => {
    setType('OTHER');
    setSeverity('MEDIUM');
    setDescription('');
    setLieu('');
    setIsSos(false);
    setError(null);
  };

  const openForm = (sos = false) => {
    resetForm();
    if (sos) {
      setIsSos(true);
      setSeverity('CRITICAL');
    }
    setSuccess(null);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    resetForm();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeTrip) return;
    if (!description.trim()) {
      setError(t('driverEvents.errorRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/incidents`, {
        type,
        severity,
        description: description.trim(),
        tripId: activeTrip.id,
        busId: activeTrip.busId ?? undefined,
        isSos,
        locationDescription: lieu.trim() || undefined,
      });
      close();
      setSuccess(t('driverEvents.successMsg'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('driverEvents.errorSend'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Journal de bord">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverEvents.pageTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('driverEvents.pageSubtitle')}
        </p>
      </header>

      {!loadingTrip && !activeTrip ? (
        <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
          <AlertCircle className="w-10 h-10 mb-3" aria-hidden />
          <p className="font-medium">{t('driverEvents.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverEvents.noActiveTripMsg')}</p>
        </div>
      ) : (
        <>
          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => openForm(false)} disabled={loadingTrip || !activeTrip}>
              <Plus className="w-4 h-4 mr-1.5" aria-hidden />
              {t('driverEvents.report')}
            </Button>

            <Button
              variant="destructive"
              onClick={() => openForm(true)}
              disabled={loadingTrip || !activeTrip}
              className="bg-red-600 hover:bg-red-700 text-white dark:bg-red-700 dark:hover:bg-red-800"
            >
              <ShieldAlert className="w-4 h-4 mr-1.5" aria-hidden />
              SOS
            </Button>
          </div>

          {/* Success feedback */}
          {success && (
            <div className="flex items-center gap-2 p-3 text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg dark:text-green-400 dark:bg-green-900/20 dark:border-green-800">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
              {success}
            </div>
          )}
        </>
      )}

      {/* ── Dialog signalement ── */}
      <Dialog
        open={open}
        onOpenChange={(v) => { if (!v) close(); }}
        title={isSos ? t('driverEvents.sosTitle') : t('driverEvents.reportTitle')}
        description={isSos ? t('driverEvents.sosDesc') : t('driverEvents.reportDesc')}
        size="lg"
      >
        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          <ErrorAlert error={error} />

          {isSos && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg dark:text-red-400 dark:bg-red-900/20 dark:border-red-800">
              <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden />
              {t('driverEvents.sosModeActive')}
            </div>
          )}

          {/* Type */}
          <div className="space-y-1.5">
            <label htmlFor="evt-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverEvents.incidentType')}
            </label>
            <select
              id="evt-type"
              value={type}
              onChange={(e) => setType(e.target.value as IncidentType)}
              className={inputClass}
              disabled={busy}
            >
              {INCIDENT_TYPES.map((it) => (
                <option key={it.value} value={it.value}>{t(it.labelKey)}</option>
              ))}
            </select>
          </div>

          {/* Severity */}
          <div className="space-y-1.5">
            <label htmlFor="evt-severity" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverEvents.severity')}
            </label>
            <select
              id="evt-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className={inputClass}
              disabled={busy || isSos}
            >
              {SEVERITIES.map((sv) => (
                <option key={sv.value} value={sv.value}>{t(sv.labelKey)}</option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="evt-desc" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverEvents.descriptionLabel')} <span className="text-red-500">*</span>
            </label>
            <textarea
              id="evt-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
              disabled={busy}
              placeholder={t('driverEvents.descPlaceholder')}
              required
            />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <label htmlFor="evt-lieu" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverEvents.location')}
            </label>
            <input
              id="evt-lieu"
              type="text"
              value={lieu}
              onChange={(e) => setLieu(e.target.value)}
              className={inputClass}
              disabled={busy}
              placeholder="Ex : point kilométrique ou lieu repérable"
            />
          </div>

          {/* isSos checkbox (visible only when not already SOS) */}
          {!isSos && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isSos}
                onChange={(e) => {
                  setIsSos(e.target.checked);
                  if (e.target.checked) setSeverity('CRITICAL');
                }}
                className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                disabled={busy}
              />
              {t('driverEvents.markAsSos')}
            </label>
          )}

          <FormFooter
            onCancel={close}
            busy={busy}
            submitLabel={isSos ? t('driverEvents.sendSos') : t('driverEvents.report')}
            pendingLabel={t('driverEvents.sending')}
          />
        </form>
      </Dialog>
    </main>
  );
}
