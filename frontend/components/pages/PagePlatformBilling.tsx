/**
 * PagePlatformBilling — Souscriptions et factures plateforme → tenants.
 *
 * Onglets :
 *   - Subscriptions : liste, changement de plan, changement de statut
 *   - Invoices      : DRAFT / ISSUED / PAID / VOID / OVERDUE, marquer payée / annuler
 *
 * Endpoints :
 *   GET   /api/platform/billing/subscriptions
 *   POST  /api/platform/billing/subscriptions                     { tenantId, planId }
 *   PATCH /api/platform/billing/subscriptions/:id/plan            { planId }
 *   PATCH /api/platform/billing/subscriptions/:id/status          { status, cancelReason? }
 *   GET   /api/platform/billing/invoices
 *   POST  /api/platform/billing/invoices/:id/issue
 *   POST  /api/platform/billing/invoices/:id/mark-paid            { paymentMethod?, paymentRef? }
 *   POST  /api/platform/billing/invoices/:id/void
 */

import { useMemo, useState, type FormEvent } from 'react';
import {
  Wallet, AlertTriangle, X, Check, FileText, CreditCard, Ban,
  RefreshCw, Plus,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPost, apiPatch }                from '../../lib/api';
import { useI18n }                          from '../../lib/i18n/useI18n';
import { Button }                          from '../ui/Button';
import { Badge }                           from '../ui/Badge';
import { Dialog }                          from '../ui/Dialog';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanSummary { id: string; slug: string; name: string; price: number; currency: string; billingCycle: string }

interface SubscriptionRow {
  id:              string;
  tenantId:        string;
  planId:          string;
  status:          string;
  startedAt:       string;
  trialEndsAt:     string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd:   string | null;
  renewsAt:        string | null;
  cancelledAt:     string | null;
  tenant:          { id: string; name: string; slug: string; country: string; isActive: boolean; provisionStatus: string };
  plan:            PlanSummary;
}

interface InvoiceRow {
  id:            string;
  subscriptionId: string;
  tenantId:       string;
  invoiceNumber:  string;
  periodStart:    string;
  periodEnd:      string;
  subtotal:       number;
  taxRate:        number;
  taxAmount:      number;
  totalAmount:    number;
  currency:       string;
  status:         string;
  issuedAt:       string | null;
  dueAt:          string | null;
  paidAt:         string | null;
  tenant:         { id: string; name: string; slug: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inp = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30 disabled:opacity-50';

function subStatusVariant(s: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (s) {
    case 'ACTIVE':    return 'success';
    case 'TRIAL':     return 'info';
    case 'PAST_DUE':  return 'warning';
    case 'SUSPENDED': return 'warning';
    case 'CANCELLED': return 'danger';
    default:          return 'default';
  }
}

function invStatusVariant(s: string): 'success' | 'warning' | 'danger' | 'info' | 'default' {
  switch (s) {
    case 'PAID':    return 'success';
    case 'ISSUED':  return 'info';
    case 'DRAFT':   return 'default';
    case 'OVERDUE': return 'danger';
    case 'VOID':    return 'warning';
    default:        return 'default';
  }
}

function formatMoney(amount: number, ccy: string): string {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy}`;
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

type Tab = 'subscriptions' | 'invoices';

// ─── Change plan dialog ──────────────────────────────────────────────────────

function ChangePlanDialog({
  open, sub, plans, busy, error, onClose, onSubmit,
}: {
  open: boolean;
  sub:  SubscriptionRow | null;
  plans: PlanSummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (planId: string) => void;
}) {
  const { t } = useI18n();
  const [selectedPlan, setSelectedPlan] = useState<string>('');

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('platformBilling.changePlan')}
      description={sub ? `${sub.tenant.name} — ${sub.plan.name}` : ''}
      size="md"
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(selectedPlan); }}
        className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformBilling.selectNewPlan')}</label>
          <select value={selectedPlan}
            onChange={e => setSelectedPlan(e.target.value)}
            className={inp} required disabled={busy}>
            <option value="">—</option>
            {plans.map(p => (
              <option key={p.id} value={p.id} disabled={p.id === sub?.planId}>
                {p.name} — {formatMoney(p.price, p.currency)} / {p.billingCycle}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || !selectedPlan}>
            <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Status dialog ──────────────────────────────────────────────────────────

function StatusDialog({
  open, sub, busy, error, onClose, onSubmit,
}: {
  open: boolean; sub: SubscriptionRow | null; busy: boolean; error: string | null;
  onClose: () => void; onSubmit: (status: string, cancelReason?: string) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState('ACTIVE');
  const [reason, setReason] = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('platformBilling.changeStatus')}
      description={sub?.tenant.name}
      size="md"
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(status, reason || undefined); }}
        className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
        )}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">{t('platformBilling.newStatus')}</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className={inp} disabled={busy}>
            <option value="ACTIVE">ACTIVE</option>
            <option value="TRIAL">TRIAL</option>
            <option value="PAST_DUE">PAST_DUE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
        </div>
        {status === 'CANCELLED' && (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium t-text">{t('platformBilling.cancelReason')}</label>
            <textarea rows={2} value={reason} maxLength={500}
              onChange={e => setReason(e.target.value)} className={inp} disabled={busy} />
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── New subscription dialog ────────────────────────────────────────────────

function NewSubDialog({
  open, plans, busy, error, onClose, onSubmit,
}: {
  open: boolean; plans: PlanSummary[]; busy: boolean; error: string | null;
  onClose: () => void; onSubmit: (body: { tenantId: string; planId: string }) => void;
}) {
  const { t } = useI18n();
  const [tenantId, setTenantId] = useState('');
  const [planId, setPlanId]     = useState('');

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('platformBilling.newSubscription')}
      description={t('platformBilling.newSubscriptionDesc')}
      size="md"
    >
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ tenantId, planId }); }} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
        )}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformBilling.tenantIdLabel')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <input type="text" value={tenantId}
            onChange={e => setTenantId(e.target.value.trim())}
            required pattern="[0-9a-fA-F-]{36}"
            className={`${inp} font-mono`} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformBilling.plan')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select value={planId} required onChange={e => setPlanId(e.target.value)} className={inp} disabled={busy}>
            <option value="">—</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price, p.currency)} / {p.billingCycle}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={busy || !tenantId || !planId}>
            {busy ? t('common.creating') : t('common.create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PagePlatformBilling() {
  const { t, dateLocale } = useI18n();
  const [tab, setTab] = useState<Tab>('subscriptions');

  const { data: subs,     loading: lSubs,   error: errSubs, refetch: refetchSubs }
    = useFetch<SubscriptionRow[]>('/api/platform/billing/subscriptions');
  const { data: invoices, loading: lInv,    error: errInv,  refetch: refetchInv }
    = useFetch<InvoiceRow[]>('/api/platform/billing/invoices');
  const { data: plans }
    = useFetch<PlanSummary[]>('/api/platform/plans');

  const [changeTarget, setChangeTarget] = useState<SubscriptionRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<SubscriptionRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const planList = useMemo(() => plans ?? [], [plans]);

  // ── Handlers subscriptions ──

  const handleChangePlan = async (planId: string) => {
    if (!changeTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/platform/billing/subscriptions/${changeTarget.id}/plan`, { planId });
      setChangeTarget(null);
      refetchSubs();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleChangeStatus = async (status: string, cancelReason?: string) => {
    if (!statusTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/platform/billing/subscriptions/${statusTarget.id}/status`, { status, cancelReason });
      setStatusTarget(null);
      refetchSubs();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleCreate = async (body: { tenantId: string; planId: string }) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost('/api/platform/billing/subscriptions', body);
      setNewOpen(false);
      refetchSubs();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // ── Handlers invoices ──

  const handleIssue = async (id: string) => {
    setBusy(true); setActionErr(null);
    try { await apiPost(`/api/platform/billing/invoices/${id}/issue`); refetchInv(); }
    catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const handleMarkPaid = async (id: string) => {
    setBusy(true); setActionErr(null);
    try { await apiPost(`/api/platform/billing/invoices/${id}/mark-paid`, {}); refetchInv(); }
    catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const handleVoid = async (id: string) => {
    setBusy(true); setActionErr(null);
    try { await apiPost(`/api/platform/billing/invoices/${id}/void`); refetchInv(); }
    catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // ── Colonnes subscriptions ──

  const subColumns: Column<SubscriptionRow>[] = [
    {
      key: 'tenant',
      header: t('platformBilling.colTenant'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <div className="min-w-0">
          <p className="text-sm font-medium t-text truncate">{row.tenant.name}</p>
          <p className="text-xs t-text-3 font-mono">{row.tenant.slug}</p>
        </div>
      ),
      csvValue: (_v, row) => `${row.tenant.name} (${row.tenant.slug})`,
    },
    {
      key: 'plan',
      header: t('platformBilling.plan'),
      cellRenderer: (_v, row) => (
        <span className="text-sm t-text-body">
          {row.plan.name}
          <span className="ml-2 text-xs t-text-3">
            ({formatMoney(row.plan.price, row.plan.currency)} / {row.plan.billingCycle})
          </span>
        </span>
      ),
      csvValue: (_v, row) => row.plan.slug,
    },
    {
      key: 'status',
      header: t('platformBilling.colStatus'),
      width: '120px',
      sortable: true,
      cellRenderer: (v) => <Badge variant={subStatusVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'renewsAt',
      header: t('platformBilling.colRenewsAt'),
      width: '130px',
      sortable: true,
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">
          {v ? new Date(String(v)).toLocaleDateString(dateLocale) : '—'}
        </span>
      ),
      csvValue: (v) => v ? new Date(String(v)).toLocaleDateString(dateLocale) : '',
    },
  ];

  const subActions: RowAction<SubscriptionRow>[] = [
    { label: t('platformBilling.changePlan'),   icon: <RefreshCw size={13} />, onClick: (r) => { setChangeTarget(r); setActionErr(null); } },
    { label: t('platformBilling.changeStatus'), icon: <Ban size={13} />,       onClick: (r) => { setStatusTarget(r); setActionErr(null); } },
  ];

  // ── Colonnes invoices ──

  const invColumns: Column<InvoiceRow>[] = [
    {
      key: 'invoiceNumber',
      header: t('platformBilling.colInvoiceNumber'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-xs font-mono t-text-body">{row.invoiceNumber}</span>
      ),
      csvValue: (_v, row) => row.invoiceNumber,
    },
    {
      key: 'tenant',
      header: t('platformBilling.colTenant'),
      cellRenderer: (_v, row) => (
        <span className="text-sm t-text-body">{row.tenant.name}</span>
      ),
      csvValue: (_v, row) => row.tenant.name,
    },
    {
      key: 'periodStart',
      header: t('platformBilling.colPeriod'),
      sortable: true,
      cellRenderer: (_v, row) => (
        <span className="text-xs t-text-3">
          {new Date(row.periodStart).toLocaleDateString(dateLocale)} →{' '}
          {new Date(row.periodEnd).toLocaleDateString(dateLocale)}
        </span>
      ),
      csvValue: (_v, row) => `${row.periodStart}/${row.periodEnd}`,
    },
    {
      key: 'totalAmount',
      header: t('platformBilling.colAmount'),
      sortable: true,
      width: '140px',
      cellRenderer: (_v, row) => (
        <span className="text-sm t-text-body tabular-nums">
          {formatMoney(row.totalAmount, row.currency)}
        </span>
      ),
      csvValue: (_v, row) => `${row.totalAmount} ${row.currency}`,
    },
    {
      key: 'status',
      header: t('platformBilling.colStatus'),
      width: '110px',
      sortable: true,
      cellRenderer: (v) => <Badge variant={invStatusVariant(String(v))} size="sm">{String(v)}</Badge>,
      csvValue: (v) => String(v ?? ''),
    },
    {
      key: 'dueAt',
      header: t('platformBilling.colDueAt'),
      width: '120px',
      cellRenderer: (v) => (
        <span className="text-xs t-text-3">{v ? new Date(String(v)).toLocaleDateString(dateLocale) : '—'}</span>
      ),
      csvValue: (v) => v ? new Date(String(v)).toLocaleDateString(dateLocale) : '',
    },
  ];

  const invActions: RowAction<InvoiceRow>[] = [
    {
      label:   t('platformBilling.issue'),
      icon:    <FileText size={13} />,
      disabled: (r) => r.status !== 'DRAFT',
      onClick: (r) => handleIssue(r.id),
    },
    {
      label:   t('platformBilling.markPaid'),
      icon:    <CreditCard size={13} />,
      disabled: (r) => ['PAID', 'VOID'].includes(r.status),
      onClick: (r) => handleMarkPaid(r.id),
    },
    {
      label:   t('platformBilling.void'),
      icon:    <Ban size={13} />,
      danger:  true,
      disabled: (r) => ['PAID', 'VOID'].includes(r.status),
      onClick: (r) => handleVoid(r.id),
    },
  ];

  // ── Render ──

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
            <Wallet className="w-5 h-5 text-teal-700 dark:text-teal-300" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('platformBilling.title')}</h1>
            <p className="text-sm t-text-2">{t('platformBilling.subtitle')}</p>
          </div>
        </div>
        {tab === 'subscriptions' && (
          <Button onClick={() => { setNewOpen(true); setActionErr(null); }}>
            <Plus className="w-4 h-4 mr-2" aria-hidden />{t('platformBilling.newSubscription')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800" role="tablist">
        {(['subscriptions', 'invoices'] as Tab[]).map(x => (
          <button
            key={x}
            role="tab"
            aria-selected={tab === x}
            onClick={() => setTab(x)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500
              ${tab === x
                ? 'border-teal-500 t-text'
                : 'border-transparent t-text-2 hover:t-text'}`}
          >
            {x === 'subscriptions' ? t('platformBilling.tabSubs') : t('platformBilling.tabInvoices')}
          </button>
        ))}
      </div>

      {actionErr && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />{actionErr}
        </div>
      )}

      {tab === 'subscriptions' && (
        <>
          {errSubs && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errSubs}</div>
          )}
          <DataTableMaster<SubscriptionRow>
            columns={subColumns}
            data={subs ?? []}
            loading={lSubs}
            rowActions={subActions}
            defaultSort={{ key: 'status', dir: 'asc' }}
            defaultPageSize={25}
            searchPlaceholder={t('platformBilling.searchSubs')}
            emptyMessage={t('platformBilling.noSubs')}
            stickyHeader
          />
        </>
      )}

      {tab === 'invoices' && (
        <>
          {errInv && (
            <div role="alert" className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errInv}</div>
          )}
          <DataTableMaster<InvoiceRow>
            columns={invColumns}
            data={invoices ?? []}
            loading={lInv}
            rowActions={invActions}
            defaultSort={{ key: 'periodEnd', dir: 'desc' }}
            defaultPageSize={25}
            searchPlaceholder={t('platformBilling.searchInvoices')}
            emptyMessage={t('platformBilling.noInvoices')}
            exportFormats={['csv', 'json']}
            exportFilename="platform-invoices"
            stickyHeader
          />
        </>
      )}

      <ChangePlanDialog
        open={!!changeTarget}
        sub={changeTarget}
        plans={planList}
        busy={busy}
        error={actionErr}
        onClose={() => setChangeTarget(null)}
        onSubmit={handleChangePlan}
      />
      <StatusDialog
        open={!!statusTarget}
        sub={statusTarget}
        busy={busy}
        error={actionErr}
        onClose={() => setStatusTarget(null)}
        onSubmit={handleChangeStatus}
      />
      <NewSubDialog
        open={newOpen}
        plans={planList}
        busy={busy}
        error={actionErr}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
