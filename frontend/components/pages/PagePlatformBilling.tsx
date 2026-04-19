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
  RefreshCw, Plus, CalendarClock,
} from 'lucide-react';
import { useFetch }                        from '../../lib/hooks/useFetch';
import { apiPost, apiPatch }                from '../../lib/api';
import { useI18n }                          from '../../lib/i18n/useI18n';
import { Button }                          from '../ui/Button';
import { Badge }                           from '../ui/Badge';
import { Dialog }                          from '../ui/Dialog';
import { ComboboxEditable }                 from '../ui/ComboboxEditable';
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

interface TenantOption {
  id:       string;
  name:     string;
  slug:     string;
  country?: string;
  /** Plan actuellement assigné au tenant (nullable — tenant neuf sans plan). */
  planId?:  string | null;
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
  open, plans, tenants, busy, error, onClose, onSubmit,
}: {
  open: boolean; plans: PlanSummary[]; tenants: TenantOption[];
  busy: boolean; error: string | null;
  onClose: () => void; onSubmit: (body: { tenantId: string; planId: string }) => void;
}) {
  const { t } = useI18n();
  const [tenantId, setTenantId] = useState('');
  const [planId, setPlanId]     = useState('');
  const [planTouched, setPlanTouched] = useState(false);

  // Reset interne à chaque ouverture — évite de conserver un état périmé.
  useMemo(() => {
    if (!open) { setTenantId(''); setPlanId(''); setPlanTouched(false); }
  }, [open]);

  const tenantOptions = useMemo(
    () => tenants.map(tn => ({
      value: tn.id,
      label: tn.name,
      hint:  `${tn.slug}${tn.country ? ' · ' + tn.country : ''}`,
    })),
    [tenants],
  );

  const selectedTenant = tenants.find(tn => tn.id === tenantId);

  /** Quand l'utilisateur choisit un tenant, on pré-charge son plan courant
   *  (s'il en a un). L'admin peut toujours le changer via le select ci-dessous
   *  — on marque alors planTouched pour ne plus écraser à une re-sélection. */
  function handleTenantPick(id: string) {
    setTenantId(id);
    if (!planTouched) {
      const tn = tenants.find(x => x.id === id);
      if (tn?.planId) setPlanId(tn.planId);
    }
  }

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

        <ComboboxEditable
          label={t('platformBilling.tenantPickLabel')}
          required
          placeholder={t('platformBilling.tenantPickPh')}
          options={tenantOptions}
          value={tenantId}
          onChange={handleTenantPick}
          disabled={busy}
        />

        {selectedTenant && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs flex items-center gap-2">
            <span className="t-text-3 shrink-0">{t('platformBilling.tenantIdLabel')}</span>
            <code className="font-mono t-text truncate">{selectedTenant.id}</code>
            {selectedTenant.planId && (
              <Badge variant="info" size="sm" className="ml-auto">
                {t('platformBilling.currentPlanTag')}
              </Badge>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-sm font-medium t-text">
            {t('platformBilling.plan')} <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select value={planId} required
            onChange={e => { setPlanId(e.target.value); setPlanTouched(true); }}
            className={inp} disabled={busy}>
            <option value="">—</option>
            {plans.map(p => (
              <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.price, p.currency)} / {p.billingCycle}</option>
            ))}
          </select>
          {selectedTenant?.planId && selectedTenant.planId === planId && (
            <p className="text-[11px] t-text-3">{t('platformBilling.planPrefilledHint')}</p>
          )}
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

// ─── Extend trial dialog ────────────────────────────────────────────────────
// Raccourcis jours proposés — pas de magic numbers enfouis dans le JSX.
// L'admin peut toujours saisir une valeur personnalisée via le champ nombre.
const EXTEND_TRIAL_PRESETS = [7, 14, 30] as const;

function ExtendTrialDialog({
  open, sub, busy, error, onClose, onSubmit,
}: {
  open: boolean; sub: SubscriptionRow | null; busy: boolean; error: string | null;
  onClose: () => void;
  onSubmit: (body: { days?: number; trialEndsAt?: string; reason?: string }) => void;
}) {
  const { t, dateLocale } = useI18n();
  const [mode, setMode]   = useState<'days' | 'date'>('days');
  const [days, setDays]   = useState<number>(EXTEND_TRIAL_PRESETS[0]);
  const [date, setDate]   = useState<string>('');
  const [reason, setReason] = useState<string>('');

  const currentEndDate = sub?.trialEndsAt
    ? new Date(sub.trialEndsAt).toLocaleDateString(dateLocale)
    : t('platformBilling.extendTrial.noCurrentEnd');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'days') {
      onSubmit({ days, reason: reason || undefined });
    } else if (date) {
      onSubmit({ trialEndsAt: new Date(date).toISOString(), reason: reason || undefined });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={t('platformBilling.extendTrial.title')}
      description={sub ? `${sub.tenant.name} · ${t('platformBilling.extendTrial.currentEnd')} ${currentEndDate}` : ''}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Mode switch */}
        <div
          role="radiogroup"
          aria-label={t('platformBilling.extendTrial.modeLabel')}
          className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-1"
        >
          {(['days', 'date'] as const).map(m => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                mode === m
                  ? 'bg-teal-600 text-white'
                  : 't-text-2 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {m === 'days' ? t('platformBilling.extendTrial.modeDays') : t('platformBilling.extendTrial.modeDate')}
            </button>
          ))}
        </div>

        {mode === 'days' ? (
          <div className="space-y-2">
            <label htmlFor="extend-days" className="block text-sm font-medium t-text">
              {t('platformBilling.extendTrial.daysLabel')}
            </label>
            <div className="flex flex-wrap gap-2">
              {EXTEND_TRIAL_PRESETS.map(n => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setDays(n)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                    days === n
                      ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                      : 'border-slate-200 dark:border-slate-700 t-text-2 hover:border-teal-400'
                  }`}
                >
                  +{n} {t('platformBilling.extendTrial.daysUnit')}
                </button>
              ))}
            </div>
            <input
              id="extend-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={e => setDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
              className={inp}
              disabled={busy}
            />
            <p className="text-xs t-text-3">{t('platformBilling.extendTrial.daysHelp')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor="extend-date" className="block text-sm font-medium t-text">
              {t('platformBilling.extendTrial.dateLabel')}
            </label>
            <input
              id="extend-date"
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDate(e.target.value)}
              className={inp}
              required
              disabled={busy}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="extend-reason" className="block text-sm font-medium t-text">
            {t('platformBilling.extendTrial.reasonLabel')}
            <span className="ml-1 text-xs t-text-3 font-normal">{t('common.optional')}</span>
          </label>
          <textarea
            id="extend-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className={inp}
            disabled={busy}
            placeholder={t('platformBilling.extendTrial.reasonPh')}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            <X className="w-4 h-4 mr-1.5" aria-hidden />{t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || (mode === 'date' && !date)}>
            <Check className="w-4 h-4 mr-1.5" aria-hidden />
            {busy ? t('common.saving') : t('platformBilling.extendTrial.confirm')}
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
  // Tenants + plan courant — alimente la recherche par nom dans la modale Nouvelle Souscription.
  // `/api/tenants` renvoie `planId`, `/api/platform/plans` le nom : on résout côté client.
  const { data: tenantsRaw }
    = useFetch<Array<{ id: string; name: string; slug: string; country: string; planId: string | null }>>('/api/tenants');

  const [changeTarget, setChangeTarget] = useState<SubscriptionRow | null>(null);
  const [statusTarget, setStatusTarget] = useState<SubscriptionRow | null>(null);
  const [extendTarget, setExtendTarget] = useState<SubscriptionRow | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const planList = useMemo(() => plans ?? [], [plans]);
  const tenantOptions = useMemo<TenantOption[]>(
    () => (tenantsRaw ?? []).map(tn => ({
      id: tn.id, name: tn.name, slug: tn.slug, country: tn.country, planId: tn.planId,
    })),
    [tenantsRaw],
  );

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

  const handleExtendTrial = async (
    body: { days?: number; trialEndsAt?: string; reason?: string },
  ) => {
    if (!extendTarget) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`/api/platform/billing/subscriptions/${extendTarget.id}/extend-trial`, body);
      setExtendTarget(null);
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
    { label: t('platformBilling.extendTrial.title'), icon: <CalendarClock size={13} />, onClick: (r) => { setExtendTarget(r); setActionErr(null); } },
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
        tenants={tenantOptions}
        busy={busy}
        error={actionErr}
        onClose={() => setNewOpen(false)}
        onSubmit={handleCreate}
      />
      <ExtendTrialDialog
        open={!!extendTarget}
        sub={extendTarget}
        busy={busy}
        error={actionErr}
        onClose={() => setExtendTarget(null)}
        onSubmit={handleExtendTrial}
      />
    </div>
  );
}
