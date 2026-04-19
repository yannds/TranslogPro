/**
 * TripIncidentDialog — Actions incident en route (admin / dispatcher).
 *
 * Actions selon état courant :
 *   - IN_PROGRESS / IN_PROGRESS_DELAYED → SUSPEND, DECLARE_MAJOR_DELAY, CANCEL_IN_TRANSIT
 *   - SUSPENDED → RESUME, CANCEL_IN_TRANSIT
 *
 * L'annulation en transit déclenche auto refunds (prorata km ou 100 %) côté backend.
 * La déclaration de retard majeur déclenche compensations (voucher/snack) selon
 * config tenant + overrides trip.
 */
import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, AlertTriangle, Pause, Play, X, Clock } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';

type Action = 'SUSPEND' | 'RESUME' | 'CANCEL_IN_TRANSIT' | 'DECLARE_DELAY';

interface TripIncidentDialogProps {
  open:     boolean;
  onClose:  () => void;
  onDone?:  () => void;
  tenantId: string;
  trip: {
    id:     string;
    status: string;
    route?: { name?: string | null; distanceKm?: number | null };
  } | null;
}

export function TripIncidentDialog({ open, onClose, onDone, tenantId, trip }: TripIncidentDialogProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [delayMinutes, setDelayMinutes] = useState<number>(0);
  const [distanceTraveled, setDistanceTraveled] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAction(null); setReason(''); setDelayMinutes(0); setDistanceTraveled(0);
      setErr(null); setOk(null);
    }
  }, [open]);

  const available: Action[] = useMemo(() => {
    if (!trip) return [];
    const s = trip.status;
    const list: Action[] = [];
    if (['IN_PROGRESS', 'IN_PROGRESS_DELAYED'].includes(s)) {
      list.push('SUSPEND', 'DECLARE_DELAY', 'CANCEL_IN_TRANSIT');
    }
    if (s === 'SUSPENDED') {
      list.push('RESUME', 'CANCEL_IN_TRANSIT', 'DECLARE_DELAY');
    }
    return list;
  }, [trip]);

  const submit = async () => {
    if (!trip || !action) return;
    setSubmitting(true); setErr(null); setOk(null);
    const base = `/api/v1/tenants/${tenantId}/trips/${trip.id}/incident`;
    try {
      switch (action) {
        case 'SUSPEND':
          if (!reason.trim()) throw new Error(t('tripIncident.reasonRequired'));
          await apiPost(`${base}/suspend`, { reason: reason.trim() });
          setOk(t('tripIncident.suspended'));
          break;
        case 'RESUME':
          await apiPost(`${base}/resume`, {});
          setOk(t('tripIncident.resumed'));
          break;
        case 'CANCEL_IN_TRANSIT':
          if (!reason.trim()) throw new Error(t('tripIncident.reasonRequired'));
          await apiPost(`${base}/cancel-in-transit`, {
            reason: reason.trim(),
            distanceTraveledKm: distanceTraveled > 0 ? distanceTraveled : undefined,
            totalDistanceKm:    trip.route?.distanceKm ?? undefined,
          });
          setOk(t('tripIncident.cancelled'));
          break;
        case 'DECLARE_DELAY':
          if (delayMinutes <= 0) throw new Error(t('tripIncident.delayMustBePositive'));
          await apiPost(`${base}/declare-major-delay`, { delayMinutes });
          setOk(t('tripIncident.delayDeclared'));
          break;
      }
      onDone?.();
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally { setSubmitting(false); }
  };

  if (!trip) return null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()} title={t('tripIncident.title')} size="lg">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">{trip.route?.name ?? trip.id.slice(0, 8)}</span>
          <Badge variant="outline">{trip.status}</Badge>
        </div>

        {available.length === 0 && (
          <div role="note" className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
            {t('tripIncident.noActionsAvailable')}
          </div>
        )}

        {!action && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {available.includes('SUSPEND') && (
              <ActionBtn icon={<Pause />} label={t('tripIncident.suspend')} onClick={() => setAction('SUSPEND')} />
            )}
            {available.includes('RESUME') && (
              <ActionBtn icon={<Play />} label={t('tripIncident.resume')} onClick={() => setAction('RESUME')} />
            )}
            {available.includes('DECLARE_DELAY') && (
              <ActionBtn icon={<Clock />} label={t('tripIncident.declareDelay')} onClick={() => setAction('DECLARE_DELAY')} />
            )}
            {available.includes('CANCEL_IN_TRANSIT') && (
              <ActionBtn icon={<X />} label={t('tripIncident.cancelInTransit')} danger onClick={() => setAction('CANCEL_IN_TRANSIT')} />
            )}
          </div>
        )}

        {action === 'SUSPEND' && (
          <FieldPrompt label={t('tripIncident.reasonLabel')} help={t('tripIncident.suspendHelp')}
            onBack={() => setAction(null)}>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('tripIncident.reasonPh')} required />
          </FieldPrompt>
        )}
        {action === 'RESUME' && (
          <p className="text-sm text-gray-700 dark:text-gray-300">{t('tripIncident.resumeConfirm')}</p>
        )}
        {action === 'DECLARE_DELAY' && (
          <FieldPrompt label={t('tripIncident.delayMinutes')} help={t('tripIncident.declareDelayHelp')}
            onBack={() => setAction(null)}>
            <Input type="number" min="1" value={delayMinutes}
              onChange={e => setDelayMinutes(parseInt(e.target.value, 10) || 0)} required />
          </FieldPrompt>
        )}
        {action === 'CANCEL_IN_TRANSIT' && (
          <div className="space-y-3">
            <div role="alert" className="flex gap-2 p-3 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
              <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{t('tripIncident.cancelInTransitWarning')}</span>
            </div>
            <label className="block">
              <span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{t('tripIncident.reasonLabel')}</span>
              <Input value={reason} onChange={e => setReason(e.target.value)} required />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{t('tripIncident.distanceTraveledKm')}</span>
              <Input type="number" min="0" step="0.1" value={distanceTraveled}
                onChange={e => setDistanceTraveled(parseFloat(e.target.value) || 0)} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{t('tripIncident.prorataHint')}</span>
            </label>
            <button type="button" onClick={() => setAction(null)} className="text-xs text-blue-600 hover:underline">
              ← {t('common.back')}
            </button>
          </div>
        )}

        {err && <ErrorAlert error={err} />}
        {ok && (
          <div role="status" className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            {ok}
          </div>
        )}

        {action && !ok && (
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button variant="outline" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
            <Button onClick={submit} loading={submitting} disabled={submitting}>
              {submitting ? t('common.saving') : t('common.confirm')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ActionBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-3 p-4 rounded-lg border transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        danger
          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
      }`}>
      <span className={`p-2 rounded-md ${danger ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'}`} aria-hidden="true">{icon}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
    </button>
  );
}

function FieldPrompt({ label, help, children, onBack }: {
  label: string; help?: string; children: React.ReactNode; onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{label}</span>
        {children}
        {help && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{help}</span>}
      </label>
      <button type="button" onClick={onBack} className="text-xs text-blue-600 hover:underline">← {t('common.back')}</button>
    </div>
  );
}
