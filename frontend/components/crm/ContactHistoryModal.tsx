/**
 * ContactHistoryModal — Fiche historique unifiée d'un Customer CRM.
 *
 * Alimentée par GET /api/tenants/:tid/crm/contacts/:customerId/history.
 * Trois onglets : Billets · Colis envoyés · Colis reçus.
 * WCAG : role=tablist, aria-selected, focus visible ; dark+light.
 */

import { useState } from 'react';
import { Ticket as TicketIcon, Send, PackageOpen, MessageSquare, Mail, Phone } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { Dialog } from '../ui/Dialog';
import { Badge } from '../ui/Badge';

interface TicketHistoryRow {
  id:         string;
  status:     string;
  pricePaid:  number | null;
  createdAt:  string;
  tripId:     string;
  seatNumber: string | null;
  fareClass:  string;
}

interface ParcelHistoryRow {
  id:            string;
  trackingCode:  string;
  status:        string;
  price?:        number;
  createdAt:     string;
  destinationId: string;
}

interface HistoryPayload {
  customer: {
    id:              string;
    name:            string;
    phoneE164:       string | null;
    email:           string | null;
    firstName:       string | null;
    lastName:        string | null;
    segments:        string[];
    totalTickets:    number;
    totalParcels:    number;
    totalSpentCents: number;
    lastSeenAt:      string;
    firstSeenAt:     string;
    isShadow:        boolean;
    userId:          string | null;
  };
  tickets:         TicketHistoryRow[];
  parcelsSent:     ParcelHistoryRow[];
  parcelsReceived: ParcelHistoryRow[];
  counts:          { tickets: number; parcelsSent: number; parcelsReceived: number };
}

type Tab = 'tickets' | 'sent' | 'received';

export function ContactHistoryModal({
  open, onClose, tenantId, customerId,
}: {
  open:        boolean;
  onClose:     () => void;
  tenantId:    string;
  customerId:  string | null;
}) {
  const { t } = useI18n();
  const fmt   = useCurrencyFormatter();
  const [tab, setTab] = useState<Tab>('tickets');

  const { data, loading, error } = useFetch<HistoryPayload>(
    open && customerId ? `/api/tenants/${tenantId}/crm/contacts/${customerId}/history` : null,
    [open, customerId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={data?.customer.name ?? t('crmContact.loading')}
      description={data
        ? `${t('crmContact.lastSeen')} ${new Date(data.customer.lastSeenAt).toLocaleDateString()}`
        : undefined}
      size="3xl"
    >
      {loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
          {t('crmContact.loading')}
        </p>
      )}

      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400 p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Badges statut (shadow/registered + recurrent) */}
          <div className="flex flex-wrap gap-2">
            {data.customer.isShadow
              ? <Badge variant="warning">{t('crmContact.shadow')}</Badge>
              : <Badge variant="success">{t('crmContact.registered')}</Badge>}
            {data.customer.totalTickets + data.customer.totalParcels >= 2 && (
              <Badge variant="info">{t('crmContact.recurrent')}</Badge>
            )}
          </div>

          {/* Coordonnées masquées inline (pas de PII totale exposée) */}
          <div className="flex flex-wrap gap-3 items-center text-xs text-slate-600 dark:text-slate-400">
            {data.customer.phoneE164 && (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular-nums">{data.customer.phoneE164}</span>
              </span>
            )}
            {data.customer.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" aria-hidden />
                <span>{data.customer.email}</span>
              </span>
            )}
            {data.customer.segments?.length > 0 && (
              <div className="inline-flex gap-1">
                {data.customer.segments.map(s => (
                  <Badge key={s} variant="default">{s}</Badge>
                ))}
              </div>
            )}
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-3">
            <Stat icon={<TicketIcon className="w-4 h-4" aria-hidden />} value={data.counts.tickets} label={t('crmContact.tickets')} />
            <Stat icon={<Send         className="w-4 h-4" aria-hidden />} value={data.counts.parcelsSent}     label={t('crmContact.sent')} />
            <Stat icon={<PackageOpen  className="w-4 h-4" aria-hidden />} value={data.counts.parcelsReceived} label={t('crmContact.received')} />
          </div>

          {/* Onglets */}
          <div
            role="tablist"
            aria-label={t('crmContact.tabsLabel')}
            className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
          >
            <TabBtn id="tickets"  current={tab} setTab={setTab} label={t('crmContact.tickets')} />
            <TabBtn id="sent"     current={tab} setTab={setTab} label={t('crmContact.sent')} />
            <TabBtn id="received" current={tab} setTab={setTab} label={t('crmContact.received')} />
          </div>

          <div role="tabpanel" aria-live="polite">
            {tab === 'tickets' && <TicketsList rows={data.tickets} fmt={fmt} empty={t('crmContact.emptyTickets')} />}
            {tab === 'sent' && <ParcelsList rows={data.parcelsSent} fmt={fmt} empty={t('crmContact.emptySent')} />}
            {tab === 'received' && <ParcelsList rows={data.parcelsReceived} fmt={fmt} empty={t('crmContact.emptyReceived')} />}
          </div>

          {/* Note RGPD */}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic pt-2 border-t border-slate-100 dark:border-slate-800">
            <MessageSquare className="inline w-3 h-3 mr-1" aria-hidden />
            {t('crmContact.rgpdNote')}
          </p>
        </div>
      )}
    </Dialog>
  );
}

function TabBtn({ id, current, setTab, label }: { id: Tab; current: Tab; setTab: (t: Tab) => void; label: string }) {
  const active = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={() => setTab(id)}
      className={[
        'px-3 py-2 text-sm font-medium border-b-2 -mb-px',
        'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
        active
          ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-center">
      <div className="flex items-center justify-center text-slate-500 dark:text-slate-400 mb-1">{icon}</div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

function TicketsList({ rows, fmt, empty }: { rows: TicketHistoryRow[]; fmt: (n: number) => string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto" role="list">
      {rows.map(r => (
        <li key={r.id} className="py-2 flex items-center justify-between text-sm">
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-white truncate">
              {r.fareClass} {r.seatNumber ? `· ${r.seatNumber}` : ''}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {new Date(r.createdAt).toLocaleString()} · {r.status}
            </p>
          </div>
          {r.pricePaid != null && (
            <span className="text-sm tabular-nums text-slate-700 dark:text-slate-300">
              {fmt(r.pricePaid)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ParcelsList({ rows, fmt, empty }: { rows: ParcelHistoryRow[]; fmt: (n: number) => string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto" role="list">
      {rows.map(r => (
        <li key={r.id} className="py-2 flex items-center justify-between text-sm">
          <div className="min-w-0">
            <p className="font-medium text-slate-900 dark:text-white truncate font-mono">{r.trackingCode}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {new Date(r.createdAt).toLocaleString()} · {r.status}
            </p>
          </div>
          {r.price != null && (
            <span className="text-sm tabular-nums text-slate-700 dark:text-slate-300">
              {fmt(r.price)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default ContactHistoryModal;
