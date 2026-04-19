/**
 * ParcelHubActionsDialog — actions hub / pickup / dispute / return.
 *
 * Actions exposées selon `parcel.status` :
 *   IN_TRANSIT            → ARRIVE_AT_HUB (nécessite stationId)
 *   AT_HUB_INBOUND        → STORE_AT_HUB | LOAD_OUTBOUND
 *   STORED_AT_HUB         → LOAD_OUTBOUND | INITIATE_RETURN
 *   AT_HUB_OUTBOUND       → DEPART_FROM_HUB
 *   ARRIVED               → NOTIFY_FOR_PICKUP
 *   AVAILABLE_FOR_PICKUP  → PICKUP | DISPUTE | INITIATE_RETURN
 *   DELIVERED             → DISPUTE
 *   RETURN_TO_SENDER      → COMPLETE_RETURN
 *
 * Permissions côté backend : data.parcel.hub_move.agency, data.parcel.pickup.agency,
 * data.parcel.dispute.own, control.parcel.return_init.tenant.
 */
import { useEffect, useState, useMemo } from 'react';
import {
  AlertCircle, Warehouse, Archive, Upload, Truck, Bell, PackageCheck,
  AlertTriangle, RotateCcw, CheckCircle2,
} from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { apiPost } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';

type Action =
  | 'ARRIVE_AT_HUB' | 'STORE_AT_HUB' | 'LOAD_OUTBOUND' | 'DEPART_FROM_HUB'
  | 'NOTIFY_FOR_PICKUP' | 'PICKUP' | 'DISPUTE' | 'INITIATE_RETURN' | 'COMPLETE_RETURN';

interface ParcelHubActionsDialogProps {
  open:     boolean;
  onClose:  () => void;
  onDone?:  () => void;
  tenantId: string;
  parcel: {
    id: string;
    trackingCode: string;
    status: string;
  } | null;
}

export function ParcelHubActionsDialog({ open, onClose, onDone, tenantId, parcel }: ParcelHubActionsDialogProps) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action | null>(null);
  const [hubStationId, setHubStationId] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAction(null); setHubStationId(''); setDisputeReason(''); setErr(null); setOk(null);
    }
  }, [open]);

  const available: Action[] = useMemo(() => {
    if (!parcel) return [];
    switch (parcel.status) {
      case 'IN_TRANSIT':           return ['ARRIVE_AT_HUB'];
      case 'AT_HUB_INBOUND':       return ['STORE_AT_HUB', 'LOAD_OUTBOUND'];
      case 'STORED_AT_HUB':        return ['LOAD_OUTBOUND', 'INITIATE_RETURN'];
      case 'AT_HUB_OUTBOUND':      return ['DEPART_FROM_HUB'];
      case 'ARRIVED':              return ['NOTIFY_FOR_PICKUP'];
      case 'AVAILABLE_FOR_PICKUP': return ['PICKUP', 'DISPUTE', 'INITIATE_RETURN'];
      case 'DELIVERED':            return ['DISPUTE'];
      case 'RETURN_TO_SENDER':     return ['COMPLETE_RETURN'];
      default:                     return [];
    }
  }, [parcel]);

  const submit = async () => {
    if (!parcel || !action) return;
    setSubmitting(true); setErr(null); setOk(null);
    const base = `/api/v1/tenants/${tenantId}/parcels/${parcel.id}`;
    try {
      switch (action) {
        case 'ARRIVE_AT_HUB':
          if (!hubStationId.trim()) throw new Error(t('parcelHub.stationIdRequired'));
          await apiPost(`${base}/hub/arrive`, { hubStationId: hubStationId.trim() }); break;
        case 'STORE_AT_HUB':    await apiPost(`${base}/hub/store`, {}); break;
        case 'LOAD_OUTBOUND':   await apiPost(`${base}/hub/load-outbound`, {}); break;
        case 'DEPART_FROM_HUB': await apiPost(`${base}/hub/depart`, {}); break;
        case 'NOTIFY_FOR_PICKUP': await apiPost(`${base}/pickup/notify`, {}); break;
        case 'PICKUP':          await apiPost(`${base}/pickup/complete`, {}); break;
        case 'DISPUTE':
          if (!disputeReason.trim()) throw new Error(t('parcelHub.reasonRequired'));
          await apiPost(`${base}/dispute`, { reason: disputeReason.trim() }); break;
        case 'INITIATE_RETURN': await apiPost(`${base}/return/initiate`, {}); break;
        case 'COMPLETE_RETURN': await apiPost(`${base}/return/complete`, {}); break;
      }
      setOk(t('parcelHub.done'));
      onDone?.();
      setTimeout(() => onClose(), 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally { setSubmitting(false); }
  };

  if (!parcel) return null;

  const ICONS: Record<Action, React.ReactNode> = {
    ARRIVE_AT_HUB:     <Warehouse />,
    STORE_AT_HUB:      <Archive />,
    LOAD_OUTBOUND:     <Upload />,
    DEPART_FROM_HUB:   <Truck />,
    NOTIFY_FOR_PICKUP: <Bell />,
    PICKUP:            <PackageCheck />,
    DISPUTE:           <AlertTriangle />,
    INITIATE_RETURN:   <RotateCcw />,
    COMPLETE_RETURN:   <CheckCircle2 />,
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()} title={t('parcelHub.title')} size="lg">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-gray-700 dark:text-gray-300">{parcel.trackingCode}</span>
          <Badge variant="outline">{parcel.status}</Badge>
        </div>

        {available.length === 0 && (
          <div role="note" className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
            {t('parcelHub.noActionsAvailable')}
          </div>
        )}

        {!action && available.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {available.map(a => (
              <button
                key={a}
                type="button"
                onClick={() => setAction(a)}
                className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="p-2 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" aria-hidden="true">{ICONS[a]}</span>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t(`parcelHub.action.${a}`)}</span>
              </button>
            ))}
          </div>
        )}

        {action === 'ARRIVE_AT_HUB' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{t('parcelHub.hubStationId')}</span>
            <Input value={hubStationId} onChange={e => setHubStationId(e.target.value)} required />
          </label>
        )}

        {action === 'DISPUTE' && (
          <label className="block">
            <span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">{t('parcelHub.disputeReason')}</span>
            <Input value={disputeReason} onChange={e => setDisputeReason(e.target.value)} required />
          </label>
        )}

        {action && action !== 'ARRIVE_AT_HUB' && action !== 'DISPUTE' && (
          <p className="text-sm text-gray-700 dark:text-gray-300">{t(`parcelHub.confirm.${action}`)}</p>
        )}

        {err && <ErrorAlert error={err} />}
        {ok && (
          <div role="status" className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            {ok}
          </div>
        )}

        {action && !ok && (
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={() => setAction(null)} className="text-xs text-blue-600 hover:underline">← {t('common.back')}</button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
              <Button onClick={submit} loading={submitting} disabled={submitting}>
                {submitting ? t('common.saving') : t('common.confirm')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
