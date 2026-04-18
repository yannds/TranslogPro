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
 * Actions déclenchent toutes les endpoints de `/api/v1/subscription/*` —
 * IEmailService côté backend confirme les changements par email. PAST_DUE
 * affiche un banner rouge avec CTA "Régler maintenant".
 */
import { useEffect, useState } from 'react';
import {
  CreditCard, Clock, AlertTriangle, CheckCircle2, XCircle, Loader2,
  RefreshCw, Ban, ExternalLink,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

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
  savedMethod: null | { method: string; provider: string | null; lastSuccessAt: string | null };
}

export function PageAdminBilling() {
  const { t, lang } = useI18n();
  const [data,     setData]     = useState<BillingDetails | null>(null);
  const [loadErr,  setLoadErr]  = useState(false);
  const [busy,     setBusy]     = useState<null | 'checkout' | 'toggle' | 'cancel' | 'resume'>(null);
  const [msg,      setMsg]      = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function reload() {
    setLoadErr(false);
    try {
      const r = await apiFetch<BillingDetails>('/api/v1/subscription/billing', { skipRedirectOn401: true });
      setData(r);
    } catch {
      setLoadErr(true);
    }
  }
  useEffect(() => { void reload(); }, []);

  if (loadErr) return <FullError onRetry={reload} />;
  if (!data)   return <FullLoading />;

  const s = data.summary;
  const numberFmt = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR', { maximumFractionDigits: 0 });
  const dateFmt   = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });

  async function toggleAutoRenew(next: boolean) {
    setBusy('toggle'); setMsg(null);
    try {
      await apiFetch('/api/v1/subscription/auto-renew', { method: 'PATCH', body: { autoRenew: next } });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.autoRenew.updated') });
    } catch (e) {
      setMsg({ kind: 'err', text: errMsg(e, t) });
    } finally { setBusy(null); }
  }

  async function launchCheckout(method: 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER') {
    setBusy('checkout'); setMsg(null);
    try {
      const r = await apiFetch<{ paymentUrl?: string }>('/api/v1/subscription/checkout', {
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
      await apiFetch('/api/v1/subscription/cancel', { method: 'POST', body: {} });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.cancel.done') });
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e, t) }); }
    finally { setBusy(null); }
  }

  async function resume() {
    setBusy('resume'); setMsg(null);
    try {
      await apiFetch('/api/v1/subscription/resume', { method: 'POST', body: {} });
      await reload();
      setMsg({ kind: 'ok', text: t('adminBilling.resume.done') });
    } catch (e) { setMsg({ kind: 'err', text: errMsg(e, t) }); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
          <CreditCard className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('adminBilling.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('adminBilling.subtitle')}</p>
        </div>
      </header>

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
              value={data.savedMethod
                ? `${t('billing.method.' + data.savedMethod.method as any)} · ${data.savedMethod.provider ?? ''}`
                : t('adminBilling.method.none')}
              hint={data.savedMethod?.lastSuccessAt
                ? `${t('adminBilling.method.lastUsed')} ${dateFmt.format(new Date(data.savedMethod.lastSuccessAt))}`
                : undefined}
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
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoBlock({
  icon: Icon, label, value, hint,
}: { icon: typeof CreditCard; label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
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
