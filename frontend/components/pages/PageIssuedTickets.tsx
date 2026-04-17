/**
 * PageIssuedTickets — Liste des billets émis
 *
 * API :
 *   GET /api/v1/tenants/:tid/tickets
 */

import {
  List, Eye, XCircle, Printer,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { ErrorAlert }    from '../ui/ErrorAlert';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type TicketStatus = 'PENDING' | 'CONFIRMED' | 'USED' | 'CANCELLED' | 'EXPIRED';

interface TicketRow {
  id:             string;
  reference:      string;
  passengerName:  string;
  passengerPhone: string | null;
  fareClass:      string;
  totalAmount:    number;
  currency:       string;
  status:         TicketStatus;
  tripReference:  string | null;
  boardingStation: string | null;
  alightingStation: string | null;
  createdAt:      string;
}

const STATUS_VARIANT: Record<TicketStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  PENDING:   'warning',
  CONFIRMED: 'success',
  USED:      'default',
  CANCELLED: 'danger',
  EXPIRED:   'danger',
};

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<TicketRow>[] {
  return [
    {
      key: 'reference', header: t('issuedTickets.route'), sortable: true,
      cellRenderer: (_v, row) => (
        <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.reference}</span>
      ),
    },
    { key: 'passengerName',   header: t('issuedTickets.passenger'), sortable: true },
    { key: 'fareClass',       header: t('issuedTickets.fareClass'), sortable: true },
    {
      key: 'boardingStation', header: t('issuedTickets.departure'),
      cellRenderer: (v) => (v as string) ?? '—',
    },
    {
      key: 'totalAmount', header: t('issuedTickets.price'), sortable: true,
      cellRenderer: (_v, row) => `${row.totalAmount.toLocaleString()} ${row.currency}`,
      csvValue: (_v, row) => String(row.totalAmount),
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
  const tenantId = user?.tenantId ?? '';

  const { data: tickets, loading, error } = useFetch<TicketRow[]>(
    tenantId ? `/api/tenants/${tenantId}/tickets` : null,
    [tenantId],
  );

  const columns = buildColumns(t);

  const rowActions: RowAction<TicketRow>[] = [
    { icon: <Eye className="w-4 h-4" />,      label: t('issuedTickets.details'), onClick: () => {} },
    { icon: <Printer className="w-4 h-4" />,   label: t('common.print'),          onClick: () => {} },
    { icon: <XCircle className="w-4 h-4" />,   label: t('issuedTickets.cancel'),  onClick: () => {} },
  ];

  return (
    <div className="p-6 min-w-0 space-y-6">
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
    </div>
  );
}
