/**
 * PageIssuedTickets — Liste des billets émis
 *
 * API :
 *   GET  /api/tenants/:tid/tickets
 *   POST /api/tenants/:tid/tickets/:id/cancel
 */

import { useState, useRef, useCallback } from 'react';
import {
  List, Eye, XCircle, Printer, AlertTriangle,
  Ticket as TicketLucide, BookMarked,
} from 'lucide-react';
import { TicketIncidentDialog } from '../tickets/TicketIncidentDialog';
import { useAuth }       from '../../lib/auth/auth.context';
import { useOfflineList } from '../../lib/hooks/useOfflineList';
import { apiPost }       from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { Dialog }        from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction, type BulkAction } from '../DataTableMaster';
import {
  TicketReceipt, BoardingPass, printTicketHtml, printHtmlBatch,
  type TicketData,
} from '../tickets/TicketReceipt';

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus =
  | 'CREATED' | 'PENDING_PAYMENT' | 'CONFIRMED'
  | 'CHECKED_IN' | 'BOARDED' | 'COMPLETED'
  | 'CANCELLED' | 'EXPIRED';

interface TicketRow extends TicketData {
  status: TicketStatus;
}

const STATUS_VARIANT: Record<TicketStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  CREATED:         'default',
  PENDING_PAYMENT: 'warning',
  CONFIRMED:       'success',
  CHECKED_IN:      'success',
  BOARDED:         'success',
  COMPLETED:       'default',
  CANCELLED:       'danger',
  EXPIRED:         'danger',
};

const CANCELLABLE: TicketStatus[] = ['CREATED', 'PENDING_PAYMENT', 'CONFIRMED'];

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<TicketRow>[] {
  return [
    {
      key: 'tripId', header: t('issuedTickets.route'), sortable: true,
      cellRenderer: (_v, row) => (
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {row.trip?.route?.name ?? row.tripId.slice(0, 8)}
        </span>
      ),
    },
    { key: 'passengerName', header: t('issuedTickets.passenger'), sortable: true },
    { key: 'fareClass',     header: t('issuedTickets.fareClass'), sortable: true },
    {
      key: 'boardingStation', header: t('issuedTickets.departure'),
      cellRenderer: (_v, row) => row.boardingStation?.name ?? '—',
    },
    {
      key: 'pricePaid', header: t('issuedTickets.price'), sortable: true,
      cellRenderer: (_v, row) => `${(row.pricePaid ?? 0).toLocaleString()} XAF`,
      csvValue: (_v, row) => String(row.pricePaid ?? 0),
    },
    {
      key: 'status', header: t('issuedTickets.status'), sortable: true,
      cellRenderer: (_v, row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
      ),
    },
    {
      key: 'createdAt', header: t('issuedTickets.date'), sortable: true,
      cellRenderer: (v) => new Date(v as string).toLocaleDateString('fr-FR'),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageIssuedTickets() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const { brand } = useTenantConfig();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}`;

  // Read-through cache : la liste passagers reste lisible hors ligne
  // (essentiel pour l'agent gare qui pointe les montées).
  const {
    items: tickets,
    loading,
    error,
    fromCache: ticketsFromCache,
    refetch,
  } = useOfflineList<TicketRow>({
    table:    'passengers',
    tenantId,
    url:      tenantId ? `${base}/tickets` : null,
    toRecord: (row) => ({ id: row.id, tripId: row.tripId ?? null }),
    deps:     [tenantId],
  });

  // ── Detail dialog ──────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<TicketRow | null>(null);

  // ── Print via hidden receipt ───────────────────────────────────────────────
  const printContainerRef = useRef<HTMLDivElement>(null);
  const [printTarget, setPrintTarget] = useState<TicketRow | null>(null);

  const handlePrint = useCallback((row: TicketRow) => {
    setPrintTarget(row);
    // Laisser le temps au composant de rendre + QR code de se générer
    setTimeout(() => {
      if (printContainerRef.current) {
        printTicketHtml(printContainerRef.current.innerHTML, brand.brandName);
      }
      setPrintTarget(null);
    }, 400);
  }, [brand.brandName]);

  // ── Bulk print — choix ticket ou carte d'embarquement ──────────────────────
  const bulkPrintRef = useRef<HTMLDivElement>(null);
  const [bulkTargets, setBulkTargets] = useState<TicketRow[]>([]);
  const [bulkMode, setBulkMode] = useState<'ticket' | 'boarding' | null>(null);
  const [bulkChoice, setBulkChoice] = useState<TicketRow[] | null>(null);

  const handleBulkRequest = useCallback((rows: TicketRow[]) => {
    // Ouvre la modal de choix du format
    setBulkChoice(rows);
  }, []);

  const handleBulkPrint = useCallback((mode: 'ticket' | 'boarding') => {
    if (!bulkChoice || bulkChoice.length === 0) return;
    setBulkTargets(bulkChoice);
    setBulkMode(mode);
    setBulkChoice(null);
    // Le useEffect du container caché rendra tous les docs ; on attend la
    // génération des QR (async via qrcode.toDataURL) puis on print.
    setTimeout(() => {
      if (bulkPrintRef.current) {
        const title = mode === 'ticket'
          ? t('issuedTickets.bulkPrintTickets')
          : t('issuedTickets.bulkPrintBoarding');
        printHtmlBatch(bulkPrintRef.current.innerHTML, brand.brandName, title);
      }
      setBulkTargets([]);
      setBulkMode(null);
    }, 600);
  }, [bulkChoice, brand.brandName, t]);

  // ── Cancel dialog ──────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<TicketRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling]     = useState(false);
  const [cancelErr, setCancelErr]       = useState<string | null>(null);
  // ── Incident dialog (no-show / rebook / refund) ────────────────────────────
  const [incidentTarget, setIncidentTarget] = useState<TicketRow | null>(null);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelErr(null);
    try {
      await apiPost(`${base}/tickets/${cancelTarget.id}/cancel`, {
        reason: cancelReason.trim() || undefined,
      });
      setCancelTarget(null);
      setCancelReason('');
      refetch();
    } catch (err) {
      setCancelErr((err as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  // ── Columns & row actions ──────────────────────────────────────────────────
  const columns = buildColumns(t);

  const rowActions: RowAction<TicketRow>[] = [
    {
      icon: <Eye className="w-4 h-4" />,
      label: t('issuedTickets.details'),
      onClick: (row) => setDetail(row),
    },
    {
      icon: <Printer className="w-4 h-4" />,
      label: t('issuedTickets.print'),
      onClick: (row) => handlePrint(row),
    },
    {
      icon: <XCircle className="w-4 h-4" />,
      label: t('issuedTickets.cancel'),
      onClick: (row) => { setCancelTarget(row); setCancelErr(null); setCancelReason(''); },
      hidden: (row) => !CANCELLABLE.includes(row.status),
      danger: true,
    },
    {
      icon: <AlertTriangle className="w-4 h-4" />,
      label: t('ticketIncident.openMenu'),
      onClick: (row) => setIncidentTarget(row),
      hidden: (row) => !['CONFIRMED', 'CHECKED_IN', 'NO_SHOW', 'LATE_ARRIVED'].includes(row.status),
    },
  ];

  const bulkActions: BulkAction<TicketRow>[] = [
    {
      icon:    <Printer className="w-4 h-4" />,
      label:   t('issuedTickets.bulkPrint'),
      onClick: handleBulkRequest,
    },
  ];

  return (
    <div className="p-6 min-w-0 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/40 shrink-0">
          <List className="w-6 h-6 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 truncate">
            {t('issuedTickets.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {t('issuedTickets.subtitle')}
          </p>
        </div>
      </div>

      {ticketsFromCache && (
        <div
          role="note"
          className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
        >
          {t('offline.cachedData')}
        </div>
      )}

      <ErrorAlert error={error} icon />

      <DataTableMaster
        data={tickets ?? []}
        columns={columns}
        rowActions={rowActions}
        bulkActions={bulkActions}
        loading={loading}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="billets-emis"
        emptyMessage={t('issuedTickets.noTickets')}
        searchPlaceholder={t('issuedTickets.searchPlaceholder')}
      />

      {/* ── Detail Dialog — affiche le vrai billet ──────────────────────────── */}
      <Dialog
        open={!!detail}
        onOpenChange={(o) => { if (!o) setDetail(null); }}
        title={t('issuedTickets.ticketDetail')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {t('common.close')}
            </Button>
            {detail && (
              <Button
                variant="outline"
                onClick={() => { setDetail(null); handlePrint(detail); }}
                leftIcon={<Printer className="w-4 h-4" />}
              >
                {t('issuedTickets.print')}
              </Button>
            )}
          </>
        }
      >
        {detail && (
          <div className="py-2">
            <TicketReceipt ticket={detail} />
          </div>
        )}
      </Dialog>

      {/* ── Cancel Dialog ───────────────────────────────────────────────────── */}
      <Dialog
        open={!!cancelTarget}
        onOpenChange={(o) => { if (!o) { setCancelTarget(null); setCancelReason(''); } }}
        title={t('issuedTickets.cancelTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setCancelTarget(null); setCancelReason(''); }}>
              {t('common.close')}
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? t('issuedTickets.cancelling') : t('issuedTickets.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('issuedTickets.cancelDesc')}
          </p>
          {cancelTarget && (
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {cancelTarget.passengerName} — {(cancelTarget.pricePaid ?? 0).toLocaleString()} XAF
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('issuedTickets.cancelReason')}
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              placeholder={t('issuedTickets.cancelReasonPlaceholder')}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <ErrorAlert error={cancelErr} icon />
        </div>
      </Dialog>

      {/* ── Bulk print format choice dialog ─────────────────────────────────── */}
      <Dialog
        open={!!bulkChoice}
        onOpenChange={(o) => { if (!o) setBulkChoice(null); }}
        title={t('issuedTickets.bulkPrintChooseTitle')}
        description={
          bulkChoice
            ? t('issuedTickets.bulkPrintChooseDesc').replace('{count}', String(bulkChoice.length))
            : ''
        }
        size="md"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleBulkPrint('ticket')}
            aria-label={t('issuedTickets.bulkPrintTickets')}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-slate-200 dark:border-slate-700 p-4 text-center transition-colors hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400 group-hover:bg-teal-600 group-hover:text-white transition-colors">
              <TicketLucide className="w-5 h-5" aria-hidden />
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('issuedTickets.bulkPrintTickets')}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('issuedTickets.bulkPrintTicketsDesc')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleBulkPrint('boarding')}
            aria-label={t('issuedTickets.bulkPrintBoarding')}
            className="group flex flex-col items-center gap-2 rounded-xl border-2 border-slate-200 dark:border-slate-700 p-4 text-center transition-colors hover:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
              <BookMarked className="w-5 h-5" aria-hidden />
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('issuedTickets.bulkPrintBoarding')}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('issuedTickets.bulkPrintBoardingDesc')}
            </span>
          </button>
        </div>
      </Dialog>

      {/* ── Hidden print container (render offscreen for serialization) ───── */}
      <div style={{ position: 'fixed', left: -9999, top: 0, width: 820 }} aria-hidden>
        {/* Single-ticket print */}
        <div ref={printContainerRef}>
          {printTarget && <TicketReceipt ticket={printTarget} />}
        </div>
        {/* Bulk print — rend tous les docs côte à côte avec page-break CSS */}
        <div ref={bulkPrintRef} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {bulkMode === 'ticket' && bulkTargets.map(ticket => (
            <TicketReceipt key={ticket.id} ticket={ticket} />
          ))}
          {bulkMode === 'boarding' && bulkTargets.map(ticket => (
            <BoardingPass key={ticket.id} ticket={ticket} />
          ))}
        </div>
      </div>

      <TicketIncidentDialog
        open={!!incidentTarget}
        onClose={() => setIncidentTarget(null)}
        onDone={refetch}
        tenantId={tenantId}
        mode="admin"
        ticket={incidentTarget ? {
          id: incidentTarget.id,
          status: incidentTarget.status,
          passengerName: incidentTarget.passengerName,
          tripId: incidentTarget.tripId,
          pricePaid: incidentTarget.pricePaid,
        } : null}
      />
    </div>
  );
}
