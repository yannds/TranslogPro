/**
 * TicketIncidentDialog — Actions scénarios ticket (no-show, rebook, refund).
 *
 * Réutilisable depuis :
 *   - admin PageIssuedTickets (row action → ouvre ce dialog)
 *   - portail voyageur PageMyTickets (self-service : rebook own + refund request)
 *
 * Le contexte (admin | own) détermine le jeu d'actions exposé et les endpoints.
 *
 * Qualité : i18n fr+en, WCAG AA + ARIA, dark+light, responsive, zéro hardcode
 * (pas de montants figés — le back-end applique la policy tenant).
 */
import { useEffect, useState, useMemo } from 'react';
import { AlertCircle, Calendar, UserX, RefreshCcw, RotateCcw } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Select } from '../ui/Select';
import { apiPost } from '../../lib/api';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';

export type TicketIncidentMode = 'admin' | 'self-service';

interface TicketIncidentDialogProps {
  open:     boolean;
  onClose:  () => void;
  onDone?:  () => void;           // callback (ex: refetch)
  tenantId: string;
  ticket: {
    id:           string;
    status:       string;
    passengerName?: string;
    tripId:       string;
    pricePaid?:   number;
  } | null;
  mode: TicketIncidentMode;
}

type Action = 'MARK_NO_SHOW' | 'REBOOK_NEXT' | 'REBOOK_LATER' | 'REQUEST_REFUND';

interface TripLite {
  id:                 string;
  departureScheduled: string;
  status:             string;
  route?: { name?: string | null };
}

export function TicketIncidentDialog({
  open, onClose, onDone, tenantId, ticket, mode,
}: TicketIncidentDialogProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Candidates trips pour REBOOK_LATER — charge uniquement si l'action est sélectionnée.
  const candidatesUrl = action === 'REBOOK_LATER' && ticket
    ? `/api/v1/tenants/${tenantId}/trips?routeForTicket=${ticket.id}&status=PLANNED,OPEN&future=true`
    : null;
  const { data: candidates } = useFetch<TripLite[]>(candidatesUrl, [action, ticket?.id]);
  const [selectedTripId, setSelectedTripId] = useState<string>('');

  useEffect(() => {
    if (!open) {
      setAction(null); setErr(null); setOk(null); setSelectedTripId('');
    }
  }, [open]);

  const availableActions: Action[] = useMemo(() => {
    if (!ticket) return [];
    const s = ticket.status;
    const list: Action[] = [];
    if (mode === 'admin' && ['CONFIRMED', 'CHECKED_IN'].includes(s)) list.push('MARK_NO_SHOW');
    if (['NO_SHOW', 'LATE_ARRIVED', 'CONFIRMED'].includes(s)) {
      list.push('REBOOK_NEXT', 'REBOOK_LATER');
    }
    if (['NO_SHOW', 'LATE_ARRIVED', 'CONFIRMED'].includes(s)) list.push('REQUEST_REFUND');
    return list;
  }, [ticket, mode]);

  const submit = async () => {
    if (!ticket || !action) return;
    setSubmitting(true); setErr(null); setOk(null);
    const base = `/api/v1/tenants/${tenantId}/tickets/${ticket.id}`;
    try {
      switch (action) {
        case 'MARK_NO_SHOW':
          await apiPost(`${base}/no-show`, {});
          setOk(t('ticketIncident.markedNoShow'));
          break;
        case 'REBOOK_NEXT':
          await apiPost(`${base}/rebook/next-available`, {});
          setOk(t('ticketIncident.rebookedNext'));
          break;
        case 'REBOOK_LATER':
          if (!selectedTripId) throw new Error(t('ticketIncident.pickTrip'));
          await apiPost(`${base}/rebook/later`, { newTripId: selectedTripId });
          setOk(t('ticketIncident.rebookedLater'));
          break;
        case 'REQUEST_REFUND':
          await apiPost(`${base}/refund-request`, { reason: ticket.status === 'NO_SHOW' ? 'NO_SHOW' : 'CLIENT_CANCEL' });
          setOk(t('ticketIncident.refundRequested'));
          break;
      }
      onDone?.();
      // Ne ferme pas immédiatement : laisse l'utilisateur voir le message de succès
      setTimeout(() => onClose(), 1500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally { setSubmitting(false); }
  };

  if (!ticket) return null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()} title={t('ticketIncident.title')} size="lg">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 dark:text-gray-400">{ticket.passengerName ?? ticket.id.slice(0, 8)}</span>
          <Badge variant="outline">{ticket.status}</Badge>
        </div>

        {availableActions.length === 0 && (
          <div role="note" className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-200">
            {t('ticketIncident.noActionsAvailable')}
          </div>
        )}

        {availableActions.length > 0 && !action && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {availableActions.includes('MARK_NO_SHOW') && (
              <ActionButton icon={<UserX />} label={t('ticketIncident.markNoShow')} onClick={() => setAction('MARK_NO_SHOW')} />
            )}
            {availableActions.includes('REBOOK_NEXT') && (
              <ActionButton icon={<RefreshCcw />} label={t('ticketIncident.rebookNext')} onClick={() => setAction('REBOOK_NEXT')} />
            )}
            {availableActions.includes('REBOOK_LATER') && (
              <ActionButton icon={<Calendar />} label={t('ticketIncident.rebookLater')} onClick={() => setAction('REBOOK_LATER')} />
            )}
            {availableActions.includes('REQUEST_REFUND') && (
              <ActionButton icon={<RotateCcw />} label={t('ticketIncident.requestRefund')} onClick={() => setAction('REQUEST_REFUND')} />
            )}
          </div>
        )}

        {action === 'MARK_NO_SHOW' && (
          <ConfirmPrompt
            text={t('ticketIncident.confirmNoShow')}
            onBack={() => setAction(null)}
          />
        )}
        {action === 'REBOOK_NEXT' && (
          <ConfirmPrompt
            text={t('ticketIncident.confirmRebookNext')}
            onBack={() => setAction(null)}
          />
        )}
        {action === 'REBOOK_LATER' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">{t('ticketIncident.pickTrip')}</p>
            <Select
              value={selectedTripId}
              onChange={e => setSelectedTripId(e.target.value)}
              options={[
                { value: '', label: t('ticketIncident.selectTrip') },
                ...(candidates ?? []).map(c => ({
                  value: c.id,
                  label: `${c.route?.name ?? c.id.slice(0, 8)} — ${new Date(c.departureScheduled).toLocaleString()}`,
                })),
              ]}
            />
          </div>
        )}
        {action === 'REQUEST_REFUND' && (
          <ConfirmPrompt
            text={t('ticketIncident.confirmRefund')}
            onBack={() => setAction(null)}
          />
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

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span className="p-2 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" aria-hidden="true">{icon}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
    </button>
  );
}

function ConfirmPrompt({ text, onBack }: { text: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700 dark:text-gray-300">{text}</p>
      <button type="button" onClick={onBack} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
        ← {t('common.back')}
      </button>
    </div>
  );
}
