/**
 * PageCashier — Vue opérationnelle caisse (données réelles)
 *
 * Données :
 *   - GET /cashier/registers/me/open          → caisse courante + compteurs
 *   - GET /cashier/registers/:id/transactions → flux + agrégats par type/méthode
 *
 * UI : light mode first + dark:, WCAG (region/role, tabular nums, aria-live).
 */

import { useMemo } from 'react';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Coins, Landmark, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { useCashierSession } from '../../lib/hooks/useCashierSession';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { CashierSessionBar } from '../cashier/CashierSessionBar';
import { cn } from '../../lib/utils';

interface TxItem {
  id:             string;
  type:           string;
  amount:         number;
  paymentMethod:  string;
  externalRef:    string | null;
  metadata:       Record<string, unknown> | null;
  createdAt:      string;
}

interface TxResponse {
  items:  TxItem[];
  total:  number;
  totals: { type: string; paymentMethod: string; _sum: { amount: number | null } }[];
}

export function PageCashier() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? '';
  const fmt = useCurrencyFormatter();
  const { register, refetch } = useCashierSession(tenantId);

  const { data: tx, loading: txLoading } = useFetch<TxResponse>(
    register ? `/api/tenants/${tenantId}/cashier/registers/${register.id}/transactions?take=100` : null,
    [register?.id, tenantId],
  );

  // ── Agrégats par type ──────────────────────────────────────────────────────
  const totalsByType = useMemo(() => {
    const out: Record<string, number> = { TICKET: 0, PARCEL: 0, LUGGAGE_FEE: 0, REFUND: 0, CASH_IN: 0, CASH_OUT: 0 };
    for (const row of tx?.totals ?? []) {
      out[row.type] = (out[row.type] ?? 0) + (row._sum.amount ?? 0);
    }
    return out;
  }, [tx]);

  const grandTotal = useMemo(() =>
    Object.values(totalsByType).reduce((s, v) => s + v, 0),
    [totalsByType],
  );

  return (
    <div className="p-4 md:p-6 space-y-4" role="region" aria-label={t('cashierDash.title')}>
      <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
        <Landmark className="w-6 h-6 text-teal-600 dark:text-teal-400" aria-hidden />
        {t('cashierDash.title')}
      </h1>

      <CashierSessionBar onChange={refetch} />

      {!register && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center">
          <Coins className="w-10 h-10 mx-auto text-slate-400 dark:text-slate-600 mb-2" aria-hidden />
          <p className="text-slate-600 dark:text-slate-400">{t('cashierDash.emptyHint')}</p>
        </div>
      )}

      {register && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Transactions */}
          <section
            aria-label={t('cashierDash.transactionsAria')}
            className="lg:col-span-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-5"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {t('cashierDash.registerOpenedAt', { time: new Date(register.openedAt).toLocaleString() })}
                </p>
                <p className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-slate-50 tabular-nums mt-1" aria-live="polite">
                  {fmt(register.initialBalance + grandTotal)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('cashierDash.theoreticalBalance')}
                </p>
              </div>
            </header>

            {txLoading && (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-4">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('common.loading')}
              </div>
            )}

            {!txLoading && (tx?.items.length ?? 0) === 0 && (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
                {t('cashierDash.noTx')}
              </p>
            )}

            {!txLoading && (tx?.items.length ?? 0) > 0 && (
              <ul className="border-t border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {tx!.items.map(item => {
                  const positive = item.amount >= 0;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        {positive
                          ? <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden />
                          : <ArrowDownRight className="w-4 h-4 text-red-500 shrink-0" aria-hidden />}
                        <span className="text-slate-400 dark:text-slate-500 tabular-nums w-14 shrink-0">
                          {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-slate-700 dark:text-slate-200 truncate">
                          {t(`cashierDash.type_${item.type}`)} · {t(`cashierDash.method_${item.paymentMethod}`)}
                          {item.externalRef && (
                            <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
                              · {item.externalRef}
                            </span>
                          )}
                        </span>
                      </div>
                      <span className={cn(
                        'tabular-nums font-semibold shrink-0',
                        positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                      )}>
                        {fmt(item.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Résumé */}
          <aside
            aria-label={t('cashierDash.summaryAria')}
            className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 md:p-5"
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              {t('cashierDash.daySummary')}
            </p>
            <SummaryRow label={t('cashierDash.ticketSales')}  value={fmt(totalsByType.TICKET ?? 0)} tone="pos" />
            <SummaryRow label={t('cashierDash.parcelSales')}  value={fmt(totalsByType.PARCEL ?? 0)} tone="pos" />
            <SummaryRow label={t('cashierDash.luggageFees')}  value={fmt(totalsByType.LUGGAGE_FEE ?? 0)} tone="pos" />
            <SummaryRow label={t('cashierDash.refunds')}      value={fmt(totalsByType.REFUND ?? 0)} tone="neg" />
            <SummaryRow label={t('cashierDash.cashIn')}       value={fmt(totalsByType.CASH_IN ?? 0)} tone="pos" />
            <SummaryRow label={t('cashierDash.cashOut')}      value={fmt(totalsByType.CASH_OUT ?? 0)} tone="neg" />
            <hr className="my-2 border-slate-200 dark:border-slate-800" />
            <SummaryRow label={t('cashierDash.net')}          value={fmt(grandTotal)} tone="bold" />
            <SummaryRow
              label={t('cashierDash.balanceExpected')}
              value={fmt(register.initialBalance + grandTotal)}
              tone="bold"
            />

            <div className="mt-4 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-200 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{t('cashierDash.auditHint')}</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone: 'pos' | 'neg' | 'bold' }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0 text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span className={cn(
        'tabular-nums',
        tone === 'pos' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'neg' && 'text-red-700 dark:text-red-400',
        tone === 'bold' && 'text-slate-900 dark:text-slate-50 font-bold',
      )}>
        {value}
      </span>
    </div>
  );
}
