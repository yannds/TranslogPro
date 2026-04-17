/**
 * PageInvoices — Facturation
 *
 * Liste et gestion des factures émises.
 *
 * API :
 *   GET    /api/v1/tenants/:tid/invoices
 *   POST   /api/v1/tenants/:tid/invoices
 *   PATCH  /api/v1/tenants/:tid/invoices/:id
 *   DELETE /api/v1/tenants/:tid/invoices/:id
 */

import { useState, type FormEvent } from 'react';
import {
  Receipt, Plus, Eye, Trash2, Send, CreditCard, X, Ban,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { FormFooter }    from '../ui/FormFooter';
import { inputClass as inp } from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'REFUNDED';

interface InvoiceRow {
  id:            string;
  invoiceNumber: string;
  customerName:  string;
  customerEmail: string | null;
  customerPhone: string | null;
  subtotal:      number;
  taxRate:       number;
  taxAmount:     number;
  totalAmount:   number;
  currency:      string;
  entityType:    string;
  status:        InvoiceStatus;
  issuedAt:      string | null;
  paidAt:        string | null;
  dueDate:       string | null;
  paymentMethod: string | null;
  createdAt:     string;
}

const STATUS_VARIANT: Record<InvoiceStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  DRAFT:     'default',
  ISSUED:    'warning',
  PAID:      'success',
  CANCELLED: 'danger',
  REFUNDED:  'danger',
};

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<InvoiceRow>[] {
  return [
    {
      key: 'invoiceNumber', header: t('invoices.colNumber'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-blue-500" />
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.invoiceNumber}</span>
        </div>
      ),
    },
    { key: 'customerName', header: t('invoices.colCustomer'), sortable: true },
    { key: 'entityType',   header: t('invoices.colType'),     sortable: true },
    {
      key: 'totalAmount', header: t('invoices.colTotal'), sortable: true,
      cellRenderer: (_v, row) => `${row.totalAmount.toLocaleString()} ${row.currency}`,
      csvValue: (_v, row) => row.totalAmount,
    },
    {
      key: 'status', header: t('invoices.colStatus'),
      cellRenderer: (_v, row) => (
        <Badge variant={STATUS_VARIANT[row.status]}>
          {t(`invoices.status${row.status.charAt(0) + row.status.slice(1).toLowerCase()}`)}
        </Badge>
      ),
    },
    {
      key: 'createdAt', header: t('invoices.colDate'), sortable: true,
      cellRenderer: (v) => new Date(v as string).toLocaleDateString(),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageInvoices() {
  const { user: me } = useAuth();
  const { t }        = useI18n();
  const tenantId     = me?.tenantId ?? '';
  const base         = `/api/v1/tenants/${tenantId}/invoices`;

  const { data: invoices, loading, refetch } = useFetch<InvoiceRow[]>(tenantId ? base : null, [tenantId]);

  const [showCreate, setShowCreate]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvoiceRow | null>(null);
  const [busy, setBusy]     = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setActionErr(null);
    try {
      await apiPost(base, {
        customerName:  fd.get('customerName'),
        customerEmail: fd.get('customerEmail') || undefined,
        customerPhone: fd.get('customerPhone') || undefined,
        subtotal:      parseFloat(fd.get('subtotal') as string),
        taxRate:       parseFloat(fd.get('taxRate') as string) || 0,
        entityType:    fd.get('entityType'),
        dueDate:       fd.get('dueDate') || undefined,
        notes:         fd.get('notes') || undefined,
      });
      setShowCreate(false); refetch();
    } catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const handleStatusChange = async (row: InvoiceRow, status: string) => {
    try { await apiPatch(`${base}/${row.id}`, { status }); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true); setActionErr(null);
    try { await apiDelete(`${base}/${deleteTarget.id}`); setDeleteTarget(null); refetch(); }
    catch (err) { setActionErr((err as Error).message); }
    finally { setBusy(false); }
  };

  const rowActions: RowAction<InvoiceRow>[] = [
    {
      label: t('invoices.issue'), icon: <Send size={13} />,
      onClick: (row) => handleStatusChange(row, 'ISSUED'),
      hidden: (row) => row.status !== 'DRAFT',
    },
    {
      label: t('invoices.markPaid'), icon: <CreditCard size={13} />,
      onClick: (row) => handleStatusChange(row, 'PAID'),
      hidden: (row) => row.status !== 'ISSUED',
    },
    {
      label: t('invoices.cancel'), icon: <Ban size={13} />,
      variant: 'danger' as const,
      onClick: (row) => handleStatusChange(row, 'CANCELLED'),
      hidden: (row) => row.status === 'PAID' || row.status === 'CANCELLED',
    },
    {
      label: t('common.delete'), icon: <Trash2 size={13} />,
      variant: 'danger' as const,
      onClick: (row) => { setDeleteTarget(row); setActionErr(null); },
      hidden: (row) => row.status !== 'DRAFT',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('invoices.title')}</h1>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" />{t('invoices.newInvoice')}
        </Button>
      </div>

      <DataTableMaster<InvoiceRow>
        columns={buildColumns(t)}
        data={invoices ?? []}
        loading={loading}
        rowActions={rowActions}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        defaultPageSize={25}
        searchPlaceholder={t('invoices.searchPlaceholder')}
        emptyMessage={t('invoices.emptyMsg')}
        exportFormats={['csv', 'json', 'xls']}
        exportFilename="factures"
        stickyHeader
      />

      {/* Dialog création */}
      <Dialog open={showCreate} onOpenChange={o => { if (!o) setShowCreate(false); }} title={t('invoices.newInvoice')} size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <ErrorAlert error={actionErr} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.customerName')} <span className="text-red-500">*</span></label>
              <input name="customerName" required className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.customerEmail')}</label>
              <input name="customerEmail" type="email" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.customerPhone')}</label>
              <input name="customerPhone" type="tel" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.entityType')} <span className="text-red-500">*</span></label>
              <select name="entityType" required className={inp} disabled={busy}>
                <option value="TICKET">{t('invoices.typeTicket')}</option>
                <option value="PARCEL">{t('invoices.typeParcel')}</option>
                <option value="SUBSCRIPTION">{t('invoices.typeSubscription')}</option>
                <option value="CORPORATE">{t('invoices.typeCorporate')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.subtotal')} <span className="text-red-500">*</span></label>
              <input name="subtotal" type="number" step="1" min="0" required className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.taxRate')}</label>
              <input name="taxRate" type="number" step="0.01" min="0" max="1" defaultValue="0" className={inp} disabled={busy} placeholder="0.18" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.dueDate')}</label>
              <input name="dueDate" type="date" className={inp} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">{t('invoices.notes')}</label>
              <input name="notes" className={inp} disabled={busy} />
            </div>
          </div>
          <FormFooter
            busy={busy}
            submitLabel={t('common.create')}
            pendingLabel={t('common.creating')}
            onCancel={() => setShowCreate(false)}
          />
        </form>
      </Dialog>

      {/* Dialog suppression */}
      <Dialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }} title={t('invoices.confirmDelete')} size="sm">
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          {t('invoices.deleteMsg')} <strong>{deleteTarget?.invoiceNumber}</strong> ?
        </p>
        <ErrorAlert error={actionErr} />
        <FormFooter busy={busy} submitLabel={t('common.delete')} pendingLabel={t('common.deleting')} onCancel={() => setDeleteTarget(null)} onSubmit={handleDelete} variant="danger" />
      </Dialog>
    </div>
  );
}
