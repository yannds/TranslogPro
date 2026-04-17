/**
 * PageIssuedTickets — Liste des billets émis
 *
 * API :
 *   GET  /api/tenants/:tid/tickets
 *   POST /api/tenants/:tid/tickets/:id/cancel
 */

import { useState, useRef, useCallback } from 'react';
import {
  List, Eye, XCircle, Printer,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost }       from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { Dialog }        from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { TicketReceipt, printTicketHtml, type TicketData } from '../tickets/TicketReceipt';

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

  const { data: tickets, loading, error, refetch } = useFetch<TicketRow[]>(
    tenantId ? `${base}/tickets` : null,
    [tenantId],
  );

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

  // ── Cancel dialog ──────────────────────────────────────────────────────────
  const [cancelTarget, setCancelTarget] = useState<TicketRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling]     = useState(false);
  const [cancelErr, setCancelErr]       = useState<string | null>(null);

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

      <ErrorAlert error={error} icon />

      <DataTableMaster
        data={tickets ?? []}
        columns={columns}
        rowActions={rowActions}
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

      {/* ── Hidden print container (render offscreen for serialization) ───── */}
      <div style={{ position: 'fixed', left: -9999, top: 0, width: 420 }} aria-hidden>
        <div ref={printContainerRef}>
          {printTarget && <TicketReceipt ticket={printTarget} />}
        </div>
      </div>
    </div>
  );
}
