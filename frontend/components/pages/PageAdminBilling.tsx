/**
 * PageAdminBilling — /admin/billing
 *
 * Dashboard self-service abonnement SaaS :
 *   - Plan actif, prochaine échéance, moyen de paiement enregistré
 *   - Toggle auto-renew
 *   - Historique des tentatives de paiement (10 dernières)
 *   - Historique des factures (12 dernières)
 *   - Résiliation (prend effet à currentPeriodEnd) + reprise
 *
 * Actions déclenchent toutes les endpoints de `/api/subscription/*` —
 * IEmailService côté backend confirme les changements par email. PAST_DUE
 * affiche un banner rouge avec CTA "Régler maintenant".
 */
import { useEffect, useState } from 'react';
import {
  CreditCard, Smartphone, Landmark, Clock, AlertTriangle, CheckCircle2,
  XCircle, Loader2, RefreshCw, Ban, Plus, Star, Trash2,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { AddPaymentMethodDialog } from '../billing/AddPaymentMethodDialog';

interface SavedMethod {
  id:          string;
  method:      string;
  provider:    string | null;
  brand:       string | null;
  last4:       string | null;
  maskedPhone: string | null;
  tokenRef:    string | null;
  customerRef: string | null;
  isDefault:   boolean;
  lastUsedAt:  string | null;
  createdAt:   string;
}

interface BillingSummary {
  status: string;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  autoRenew: boolean;
  plan: null | { slug: string; name: string; price: number; currency: string; billingCycle: string };
}
interface BillingDetails {
  summary: BillingSummary;
  intents: Array<{ id: string; status: string; amount: number; currency: string; createdAt: string; settledAt: string | null }>;
  invoices: Array<{ id: string; number: string; status: string; totalAmount: number; currency: string; createdAt: string; paidAt: string | null }>;
  savedMethod: null | {
    method:        string;
    provider:      string | null;
    lastSuccessAt: string | null;
    brand:         string | null;
    last4:         string | null;
    maskedPhone:   string | null;  // '+242 ••••• 567' pour MoMo/Wave
    tokenized:     boolean;
  };
}

export function PageAdminBilling() {
  const { t, lang } = useI18n();
  // État sentinel en 3 temps : `undefined` = chargement initial, `null` = le
  // backend a répondu sans souscription (tenant non-onboardé / pas encore
  // provisionné), `BillingDetails` = OK. Sans cette distinction, une réponse
  // `null` valide fige la page sur un spinner infini (régression observée).
  const [data,      setData]      = useState<BillingDetails | null | undefined>(undefined);
  const [loadErr,   setLoadErr]   = useState(false);
  const [busy,      setBusy]      = useState<null | 'checkout' | 'toggle' | 'cancel' | 'resume' | 'pm'>(null);
  const [msg,       setMsg]       = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [methods,   setMethods]   = useState<SavedMethod[]>([]);
  const [addOpen,   setAddOpen]   = useState(false);
  const [deleteTgt, setDeleteTgt] = useState<SavedMethod | null>(null);
  const [pmBusyId,  setPmBusyId]  = useState<string | null>(null);

  async function reload() {
    setLoadErr(false);
    setData(undefined);
    try {
      const r = await apiFetch<BillingDetails | null>('/api/subscription/billing', { skipRedirectOn401: true });
      setData(r ?? null);
      // Liste des moyens enregistrés — on ne bloque pas le rendu si l'appel échoue
      try {
        const list = await apiFetch<SavedMethod[]>('/api/subscription/payment-methods');
        setMethods(list);
      } catch { /* tolérant : la page peut rester utilisable sans cette liste */ }
    } catch {
      setLoadErr(true);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function setMethodDefault(m: SavedMethod) {
    setPmBusyId(m.id);
    try {
      await apiFetch(`/api/subscription/payment-methods/${m.id}/default`, { method: 'PUT' });
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e, t) });
    } finally {
      setPmBusyId(null);
    }
  }

  async function doDeleteMethod() {
    if (!deleteTgt) return;
    setPmBusyId(deleteTgt.id);
    try {
      await apiFetch(`/api/subscription/payment-methods/${deleteTgt.id}`, { method: 'DELETE' });
      setDeleteTgt(null);
      await reload();
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e, t) });
    } finally {
      setPmBusyId(null);
    }
  }

  if (loadErr)        return <FullError onRetry={reload} />;
  if (data === undefined) return <FullLoading />;
  if (data === null)  return <NoSubscription onRetry={reload} />;

  const s = data.summary;
  const numberFmt = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 0 });
  const dateFmt   = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  async function toggleAutoRenew(next: boolean) {
    setBusy('toggle'); setMsg(null);
    try {
      await apiFetch('/api/subscription/auto-renew', { method: 'PATCH', body: { autoRenew: next } });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.autoRenew.updated') });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e, t) });
    } finally { setBusy(null); }
  }

  async function launchCheckout(method: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER') {
    setBusy('checkout'); setMsg(null);
    try {
      const r = await apiFetch<{ paymentUrl?: string }>('/api/subscription/checkout', {
        method: 'POST',
        body:   { method },
      });
      if (r.paymentUrl) window.location.href = r.paymentUrl;
      else setMsg({ kind: 'err', text: t('adminBilling.checkout.noUrl') });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e, t) });
    } finally { setBusy(null); }
  }

  async function cancel() {
    if (!confirm(t('adminBilling.cancel.confirm'))) return;
    setBusy('cancel'); setMsg(null);
    try {
      await apiFetch('/api/subscription/cancel', { method: 'POST', body: {} });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.cancel.done') });
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e, t) }); }
    finally { setBusy(null); }
  }

  async function resume() {
    setBusy('resume'); setMsg(null);
    try {
      await apiFetch('/api/subscription/resume', { method: 'POST', body: {} });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.resume.done') });
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e, t) }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-md border p-3 text-sm',
            msg.kind === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200',
          )}
        >
          {msg.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* PAST_DUE banner */}
      {s.status === 'PAST_DUE' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40">
          <div className="flex items-center gap-2 text-red-900 dark:text-red-100">
            <AlertTriangle className="h-5 w-5" aria-hidden />
            <div>
              <p className="text-sm font-semibold">{t('adminBilling.pastDue.title')}</p>
              <p className="text-xs text-red-800/80 dark:text-red-200/80">{t('adminBilling.pastDue.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void launchCheckout('CARD')}
            disabled={busy !== null}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-60"
          >
            <CreditCard className="h-4 w-4" aria-hidden />
            {t('adminBilling.pastDue.cta')}
          </button>
        </div>
      )}

      {/* Plan card */}
      <section className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {t('adminBilling.plan.current')}
              </p>
              <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
                {s.plan?.name ?? '—'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {s.plan
                  ? `${numberFmt.format(s.plan.price)} ${s.plan.currency} ${billingCycleLabel(s.plan.billingCycle, t)}`
                  : ''}
              </p>
            </div>
            <StatusBadge status={s.status} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoBlock
              icon={Clock}
              label={t('adminBilling.plan.nextBilling')}
              value={s.currentPeriodEnd ? dateFmt.format(new Date(s.currentPeriodEnd)) : '—'}
              hint={s.cancelledAt ? t('adminBilling.plan.endsOnCancel') : undefined}
            />
            <InfoBlock
              icon={CreditCard}
              label={t('adminBilling.method.saved')}
              value={formatSavedMethod(data.savedMethod, t)}
              hint={savedMethodHint(data.savedMethod, dateFmt, t)}
              action={
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="text-xs font-medium text-teal-700 hover:text-teal-900 hover:underline dark:text-teal-300 dark:hover:text-teal-100"
                >
                  {t('adminBilling.method.add')}
                </button>
              }
            />
          </div>

          {/* Auto-renew toggle */}
          <div className="mt-5 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                {t('adminBilling.autoRenew.title')}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t('adminBilling.autoRenew.hint')}
              </p>
            </div>
            <Toggle
              checked={s.autoRenew}
              onChange={v => void toggleAutoRenew(v)}
              disabled={busy !== null || s.status === 'CANCELLED' || s.status === 'SUSPENDED'}
            />
          </div>
        </div>

        {/* Side actions */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('adminBilling.actions.title')}
          </p>
          <div className="mt-3 space-y-2">
            {(s.status === 'TRIAL' || s.status === 'PAST_DUE') && s.plan && s.plan.price > 0 && (
              <button
                type="button"
                onClick={() => void launchCheckout('CARD')}
                disabled={busy !== null}
                className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-teal-600 px-4 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-60"
              >
                {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
                {t('adminBilling.actions.pay')}
              </button>
            )}

            {s.status === 'ACTIVE' && !s.cancelledAt && (
              <button
                type="button"
                onClick={cancel}
                disabled={busy !== null}
                className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                {busy === 'cancel' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
                {t('adminBilling.actions.cancel')}
              </button>
            )}

            {s.cancelledAt && s.status !== 'CANCELLED' && s.status !== 'SUSPENDED' && (
              <button
                type="button"
                onClick={resume}
                disabled={busy !== null}
                className="inline-flex w-full h-10 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-60"
              >
                {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                {t('adminBilling.actions.resume')}
              </button>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            {t('adminBilling.actions.hint')}
          </p>
        </div>
      </section>

      {/* Saved payment methods */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t('paymentMethods.savedHeading')}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t('paymentMethods.subtitle')}
            </p>
          </div>
          <Button
            type="button" variant="default" size="sm"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t('paymentMethods.add')}
          </Button>
        </header>
        {methods.length === 0 ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            <CreditCard className="h-8 w-8 text-slate-400" aria-hidden />
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {t('paymentMethods.emptyTitle')}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('paymentMethods.emptyBody')}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {methods.map(m => (
              <li key={m.id}>
                <SavedMethodRow
                  method={m}
                  busy={pmBusyId === m.id}
                  onSetDefault={() => setMethodDefault(m)}
                  onDelete={() => setDeleteTgt(m)}
                  dateFmt={dateFmt}
                  t={t}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invoices */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('adminBilling.invoices.title')}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.invoices.length} {t('adminBilling.invoices.count')}
          </span>
        </header>
        {data.invoices.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">{t('adminBilling.invoices.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.invoices.map(inv => (
              <li key={inv.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{inv.number}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {dateFmt.format(new Date(inv.createdAt))}
                    {inv.paidAt && ` · ${t('adminBilling.invoices.paidAt')} ${dateFmt.format(new Date(inv.paidAt))}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {numberFmt.format(inv.totalAmount)} {inv.currency}
                  </span>
                  <InvoiceStatus status={inv.status} t={t} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent attempts */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {t('adminBilling.history.title')}
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {data.intents.length} {t('adminBilling.history.count')}
          </span>
        </header>
        {data.intents.length === 0 ? (
          <p className="p-5 text-sm text-slate-500 dark:text-slate-400">{t('adminBilling.history.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.intents.map(it => (
              <li key={it.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {dateFmt.format(new Date(it.createdAt))}
                  </p>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{it.id.slice(0, 12)}…</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">
                    {numberFmt.format(it.amount)} {it.currency}
                  </span>
                  <IntentStatus status={it.status} t={t} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddPaymentMethodDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        subscriptionStatus={s.status}
      />

      {deleteTgt && (
        <DeleteMethodDialog
          method={deleteTgt}
          busy={pmBusyId === deleteTgt.id}
          onConfirm={doDeleteMethod}
          onClose={() => setDeleteTgt(null)}
          t={t}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoBlock({
  icon: Icon, label, value, hint, action,
}: {
  icon: typeof CreditCard; label: string; value: string; hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex-1">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2',
        checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, { cls: string; label: string }> = {
    TRIAL:     { cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200',          label: t('adminBilling.status.TRIAL') },
    ACTIVE:    { cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200', label: t('adminBilling.status.ACTIVE') },
    PAST_DUE:  { cls: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',          label: t('adminBilling.status.PAST_DUE') },
    SUSPENDED: { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',  label: t('adminBilling.status.SUSPENDED') },
    CANCELLED: { cls: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',     label: t('adminBilling.status.CANCELLED') },
  };
  const v = map[status] ?? { cls: 'bg-slate-200 text-slate-700', label: status };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider', v.cls)}>
      {v.label}
    </span>
  );
}

function IntentStatus({ status, t }: { status: string; t: (k: string) => string }) {
  const icon = status === 'SUCCEEDED' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
             : status === 'FAILED'    ? <XCircle    className="h-4 w-4 text-red-500" aria-hidden />
             : <Clock className="h-4 w-4 text-slate-400" aria-hidden />;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
      {icon}
      {t('adminBilling.intent.' + status as any) || status}
    </span>
  );
}

function InvoiceStatus({ status, t }: { status: string; t: (k: string) => string }) {
  const cls = status === 'PAID'    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200'
            : status === 'OVERDUE' ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'
            : status === 'ISSUED'  ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200'
            : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider', cls)}>
      {t('adminBilling.invoice.' + status as any) || status}
    </span>
  );
}

function FullLoading() {
  return (
    <div className="flex items-center justify-center p-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
    </div>
  );
}
function NoSubscription({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <CreditCard className="h-6 w-6" aria-hidden />
        </span>
        <div className="max-w-md">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('adminBilling.noSubscription.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {t('adminBilling.noSubscription.body')}
          </p>
        </div>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('adminBilling.retry')}
        </button>
      </div>
    </div>
  );
}
function FullError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
      <p className="text-sm text-slate-600 dark:text-slate-400">{t('adminBilling.loadError')}</p>
      <button onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-500">
        <RefreshCw className="h-4 w-4" aria-hidden /> {t('adminBilling.retry')}
      </button>
    </div>
  );
}

function errMsg(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiError) {
    if (e.status === 400) return t('adminBilling.error.bad');
    if (e.status === 429) return t('adminBilling.error.rateLimit');
  }
  return t('adminBilling.error.generic');
}

function billingCycleLabel(cycle: string, t: (k: string) => string): string {
  if (cycle === 'MONTHLY') return t('adminBilling.cycle.monthly');
  if (cycle === 'YEARLY')  return t('adminBilling.cycle.yearly');
  return '';
}

/**
 * Formate le moyen de paiement pour affichage. Priorité à la représentation
 * "marque •••• last4" si le provider nous a donné la tokenisation, sinon on
 * retombe sur le libellé générique du canal + provider.
 */
function formatSavedMethod(
  m: BillingDetails['savedMethod'],
  t: (k: string) => string,
): string {
  if (!m) return t('adminBilling.method.none');
  // Carte : Visa •••• 4242
  if (m.brand && m.last4) return `${m.brand} •••• ${m.last4}`;
  // MoMo / Wave : numéro masqué
  if (m.maskedPhone) {
    const providerLabel = m.provider
      ? m.provider.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : t(('billing.method.' + m.method) as any);
    return `${providerLabel} ${m.maskedPhone}`;
  }
  const label = t(('billing.method.' + m.method) as any);
  return m.provider ? `${label} · ${m.provider}` : label;
}

function savedMethodHint(
  m: BillingDetails['savedMethod'],
  dateFmt: Intl.DateTimeFormat,
  t: (k: string) => string,
): string | undefined {
  if (!m) return undefined;
  const parts: string[] = [];
  if (m.tokenized) parts.push(t('adminBilling.method.tokenized'));
  if (m.lastSuccessAt) parts.push(`${t('adminBilling.method.lastUsed')} ${dateFmt.format(new Date(m.lastSuccessAt))}`);
  return parts.length ? parts.join(' · ') : undefined;
}

// ─── Saved methods row & delete confirm ──────────────────────────────────────

function SavedMethodRow({
  method, busy, onSetDefault, onDelete, dateFmt, t,
}: {
  method: SavedMethod; busy: boolean;
  onSetDefault: () => void; onDelete: () => void;
  dateFmt: Intl.DateTimeFormat;
  t: (k: string) => string;
}) {
  const Icon = method.method === 'CARD' ? CreditCard
            : method.method === 'MOBILE_MONEY' ? Smartphone
            : Landmark;
  const label = method.method === 'MOBILE_MONEY' && method.maskedPhone
    ? `${method.brand ?? method.provider ?? 'Mobile Money'}  ${method.maskedPhone}`
    : method.method === 'CARD' && method.last4
      ? `${method.brand ?? 'Card'}  •••• ${method.last4}`
      : t(('billing.method.' + method.method) as any);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="flex items-center gap-3">
        <span className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-full',
          method.isDefault
            ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        )}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">{label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {method.isDefault && (
              <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                <Star className="h-2.5 w-2.5" aria-hidden />
                {t('paymentMethods.default')}
              </span>
            )}
            {method.lastUsedAt && (
              <>{t('paymentMethods.lastUsed')} {dateFmt.format(new Date(method.lastUsedAt))}</>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!method.isDefault && (
          <Button
            type="button" size="sm" variant="ghost" disabled={busy}
            onClick={onSetDefault}
            className="inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Star className="h-3.5 w-3.5" aria-hidden />}
            {t('paymentMethods.makeDefault')}
          </Button>
        )}
        <Button
          type="button" size="sm" variant="ghost" disabled={busy}
          onClick={onDelete}
          className="inline-flex items-center gap-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t('paymentMethods.remove')}
        </Button>
      </div>
    </div>
  );
}

function DeleteMethodDialog({ method, busy, onConfirm, onClose, t }: {
  method: SavedMethod; busy: boolean;
  onConfirm: () => void; onClose: () => void;
  t: (k: string) => string;
}) {
  const label = method.maskedPhone ?? (method.last4 ? `•••• ${method.last4}` : method.method);
  return (
    <Dialog open onOpenChange={o => !o && onClose()} title={t('paymentMethods.deleteTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {t('paymentMethods.deleteBody').replace('{label}', label)}
        </p>
        {method.isDefault && (
          <div role="note" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('paymentMethods.deleteDefaultWarn')}</span>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button" variant="destructive" onClick={onConfirm} disabled={busy}
            className="inline-flex items-center gap-1.5"
          >
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('paymentMethods.removing')}</>
              : <><CheckCircle2 className="h-4 w-4" aria-hidden /> {t('paymentMethods.confirmRemove')}</>}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
