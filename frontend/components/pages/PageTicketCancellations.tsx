/**
 * PageTicketCancellations — Annulations de billets
 *
 * API :
 *   GET /api/v1/tenants/:tid/tickets?status=CANCELLED
 */

import {
  XCircle, Eye, RotateCcw,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { ErrorAlert }    from '../ui/ErrorAlert';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CancelledTicketRow {
  id:              string;
  reference:       string;
  passengerName:   string;
  passengerPhone:  string | null;
  fareClass:       string;
  totalAmount:     number;
  currency:        string;
  tripReference:   string | null;
  cancelledAt:     string | null;
  cancellationReason: string | null;
  refundStatus:    string | null;
  createdAt:       string;
}

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<CancelledTicketRow>[] {
  return [
    {
      key: 'reference', header: t('ticketCancellations.route'), sortable: true,
      cellRenderer: (_v, row) => (
        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.reference}</span>
      ),
    },
    { key: 'passengerName',  header: t('ticketCancellations.passenger'), sortable: true },
    {
      key: 'totalAmount', header: t('ticketCancellations.price'), sortable: true,
      cellRenderer: (_v, row) => `${row.totalAmount.toLocaleString()} ${row.currency}`,
      csvValue: (_v, row) => String(row.totalAmount),
    },
    { key: 'cancellationReason', header: t('ticketCancellations.reason') },
    {
      key: 'refundStatus', header: t('ticketCancellations.refundStatus'), sortable: true,
      cellRenderer: (v) => {
        const s = v as string | null;
        if (!s) return '—';
        const variant = s === 'REFUNDED' ? 'success' : s === 'PENDING' ? 'warning' : 'default';
        return <Badge variant={variant}>{s}</Badge>;
      },
    },
    {
      key: 'cancelledAt', header: t('ticketCancellations.date'), sortable: true,
      cellRenderer: (v) => v ? new Date(v as string).toLocaleDateString('fr-FR') : '—',
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageTicketCancellations() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';

  const { data: tickets, loading, error } = useFetch<CancelledTicketRow[]>(
    tenantId ? `/api/tenants/${tenantId}/tickets?status=CANCELLED` : null,
    [tenantId],
  );

  const columns = buildColumns(t);

  const rowActions: RowAction<CancelledTicketRow>[] = [
    { icon: <Eye className="w-4 h-4" />,        label: t('ticketCancellations.view'),   onClick: () => {} },
    { icon: <RotateCcw className="w-4 h-4" />,  label: t('ticketCancellations.refund'), onClick: () => {} },
  ];

  return (
    <div className="p-6 min-w-0 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/40 shrink-0">
          <XCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 truncate">
            {t('ticketCancellations.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {t('ticketCancellations.subtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <DataTableMaster
        data={tickets ?? []}
        columns={columns}
        rowActions={rowActions}
        loading={loading}
        defaultSort={{ key: 'cancelledAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="annulations-billets"
        emptyMessage={t('ticketCancellations.noTickets')}
        searchPlaceholder={t('ticketCancellations.searchPlaceholder')}
      />
    </div>
  );
}
