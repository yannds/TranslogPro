/**
 * PageSavRefunds — Gestion des remboursements
 *
 * Deux déclencheurs :
 *   1. Voyageur annule son billet   → raison CLIENT_CANCEL
 *   2. Compagnie annule un trajet   → raison TRIP_CANCELLED (bulk, 100%)
 *
 * Workflow : PENDING → APPROVED → PROCESSED | REJECTED
 *
 * API :
 *   GET  /api/tenants/:tid/sav/refunds
 *   POST /api/tenants/:tid/sav/refunds/:id/approve
 *   POST /api/tenants/:tid/sav/refunds/:id/process
 *   POST /api/tenants/:tid/sav/refunds/:id/reject
 */

import { useState } from 'react';
import {
  RotateCcw, Eye, CheckCircle2, CreditCard, Ban,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { apiPost }       from '../../lib/api';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { Button }        from '../ui/Button';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import { inputClass }    from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type RefundStatus = 'PENDING' | 'APPROVED' | 'PROCESSED' | 'REJECTED';

interface RefundRow {
  id:            string;
  tenantId:      string;
  ticketId:      string;
  tripId:        string | null;
  amount:        number;
  currency:      string;
  reason:        string;
  status:        RefundStatus;
  paymentMethod: string | null;
  approvedBy:    string | null;
  approvedAt:    string | null;
  processedBy:   string | null;
  processedAt:   string | null;
  rejectedBy:    string | null;
  rejectedAt:    string | null;
  notes:         string | null;
  createdAt:     string;
}

const STATUS_VARIANT: Record<RefundStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  PENDING:   'warning',
  APPROVED:  'default',
  PROCESSED: 'success',
  REJECTED:  'danger',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function PageSavRefunds() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/sav/refunds`;

  const [rev, setRev]           = useState(0);
  const { data, loading, error } = useFetch<RefundRow[]>(tenantId ? base : null, [tenantId, rev]);
  const refunds = data ?? [];

  const [detail, setDetail]     = useState<RefundRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RefundRow | null>(null);
  const [rejectNotes, setRejectNotes]   = useState('');
  const [busy, setBusy]         = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reasonLabel = (r: string) =>
    r === 'TRIP_CANCELLED' ? t('savRefunds.reasonTripCancelled') : t('savRefunds.reasonClientCancel');

  // ── Actions ──

  async function doAction(id: string, action: 'approve' | 'process' | 'reject', body?: Record<string, unknown>) {
    setBusy(true);
    setActionErr(null);
    try {
      await apiPost(`${base}/${id}/${action}`, body ?? {});
      setRev(r => r + 1);
      setDetail(null);
      setRejectTarget(null);
      setRejectNotes('');
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : t('savRefunds.errorAction'));
    } finally {
      setBusy(false);
    }
  }

  // ── Columns ──

  const columns: Column<RefundRow>[] = [
    {
      key: 'ticketId', header: t('savRefunds.colTicket'), sortable: true,
      cellRenderer: (v) => (
        <span className="font-mono text-xs text-slate-900 dark:text-slate-100">{(v as string).slice(0, 10)}</span>
      ),
    },
    {
      key: 'amount', header: t('savRefunds.colAmount'), sortable: true, align: 'right',
      cellRenderer: (_v, row) => `${row.amount.toLocaleString('fr-FR')} ${row.currency}`,
      csvValue: (_v, row) => String(row.amount),
    },
    {
      key: 'reason', header: t('savRefunds.colReason'), sortable: true,
      cellRenderer: (v) => (
        <Badge size="sm" variant={v === 'TRIP_CANCELLED' ? 'danger' : 'warning'}>
          {reasonLabel(v as string)}
        </Badge>
      ),
    },
    {
      key: 'status', header: t('savRefunds.colStatus'), sortable: true,
      cellRenderer: (_v, row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
      ),
    },
    {
      key: 'createdAt', header: t('savRefunds.colDate'), sortable: true,
      cellRenderer: (v) => new Date(v as string).toLocaleDateString('fr-FR'),
    },
  ];

  // ── Row actions ──

  const rowActions: RowAction<RefundRow>[] = [
    { icon: <Eye className="w-4 h-4" />,          label: t('savRefunds.details'), onClick: (r) => setDetail(r) },
    { icon: <CheckCircle2 className="w-4 h-4" />, label: t('savRefunds.approve'), onClick: (r) => doAction(r.id, 'approve') },
    { icon: <CreditCard className="w-4 h-4" />,   label: t('savRefunds.process'), onClick: (r) => doAction(r.id, 'process') },
    { icon: <Ban className="w-4 h-4" />,           label: t('savRefunds.reject'),  onClick: (r) => setRejectTarget(r) },
  ];

  // ── Render ──

  return (
    <main className="p-6 min-w-0 space-y-6" role="main" aria-label={t('savRefunds.title')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
          <RotateCcw className="w-5 h-5 text-rose-600 dark:text-rose-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white truncate">{t('savRefunds.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('savRefunds.subtitle')}</p>
        </div>
      </div>

      <ErrorAlert error={error ?? actionErr} icon />

      <DataTableMaster<RefundRow>
        columns={columns}
        data={refunds}
        loading={loading}
        rowActions={rowActions}
        onRowClick={(row) => setDetail(row)}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="remboursements"
        emptyMessage={t('savRefunds.noRefunds')}
        searchPlaceholder={t('savRefunds.searchPlaceholder')}
      />

      {/* ── Detail dialog ── */}
      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}
        title={t('savRefunds.refundDetail')} size="lg">
        {detail && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colTicket')}</p>
              <p className="font-mono text-slate-900 dark:text-slate-100">{detail.ticketId.slice(0, 16)}</p>
            </div>
            {detail.tripId && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colTrip')}</p>
                <p className="font-mono text-slate-900 dark:text-slate-100">{detail.tripId.slice(0, 16)}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colAmount')}</p>
              <p className="tabular-nums font-medium">{detail.amount.toLocaleString('fr-FR')} {detail.currency}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colReason')}</p>
              <Badge variant={detail.reason === 'TRIP_CANCELLED' ? 'danger' : 'warning'}>
                {reasonLabel(detail.reason)}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colStatus')}</p>
              <Badge variant={STATUS_VARIANT[detail.status] ?? 'default'}>{detail.status}</Badge>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.colDate')}</p>
              <p>{new Date(detail.createdAt).toLocaleString('fr-FR')}</p>
            </div>
            {detail.processedAt && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.processedAt')}</p>
                <p>{new Date(detail.processedAt).toLocaleString('fr-FR')}</p>
              </div>
            )}
            {detail.notes && (
              <div className="col-span-2">
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savRefunds.notes')}</p>
                <p className="text-slate-700 dark:text-slate-300">{detail.notes}</p>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {/* ── Reject dialog ── */}
      <Dialog open={!!rejectTarget} onOpenChange={o => { if (!o) { setRejectTarget(null); setRejectNotes(''); } }}
        title={t('savRefunds.rejectTitle')} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('savRefunds.rejectConfirm')}</p>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {t('savRefunds.rejectNotes')}
            </label>
            <textarea
              className={inputClass}
              rows={3}
              value={rejectNotes}
              onChange={e => setRejectNotes(e.target.value)}
              placeholder={t('savRefunds.rejectNotesPlaceholder')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectNotes(''); }}>
              {t('savRefunds.cancelAction')}
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={busy}
              onClick={() => rejectTarget && doAction(rejectTarget.id, 'reject', { notes: rejectNotes })}
            >
              {t('savRefunds.confirmReject')}
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
