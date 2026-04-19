/**
 * PageMyVouchers — "Mes bons de réduction" (portail voyageur).
 *
 * Liste les vouchers émis au bénéficiaire connecté (via customerId ou phone).
 * Endpoint : GET /api/v1/tenants/:tid/vouchers/my
 * Permission : data.voucher.read.own
 */
import { Gift, Loader2, Calendar, AlertCircle } from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';

interface MyVoucher {
  id:            string;
  code:          string;
  amount:        number;
  currency:      string;
  status:        'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  origin:        string;
  usageScope:    string;
  validityEnd:   string;
  redeemedAt?:   string | null;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

const STATUS_CLS: Record<MyVoucher['status'], string> = {
  ISSUED:    'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  REDEEMED:  'bg-slate-100  text-slate-600   border-slate-200   dark:bg-slate-800/40 dark:text-slate-300  dark:border-slate-700',
  EXPIRED:   'bg-amber-100  text-amber-700   border-amber-200   dark:bg-amber-900/30 dark:text-amber-300  dark:border-amber-800',
  CANCELLED: 'bg-red-100    text-red-700     border-red-200     dark:bg-red-900/30   dark:text-red-300    dark:border-red-800',
};

export function PageMyVouchers() {
  const { user }  = useAuth();
  const { t }     = useI18n();
  const url = user?.tenantId ? `/api/v1/tenants/${user.tenantId}/vouchers/my` : null;
  const { data, loading, error } = useFetch<MyVoucher[]>(url, [user?.tenantId]);
  const vouchers = data ?? [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <header className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
          <Gift className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('myVouchers.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('myVouchers.subtitle')}</p>
        </div>
      </header>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
          {String(error)}
        </div>
      )}

      {!loading && !error && vouchers.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
          <Gift className="w-8 h-8 text-slate-400 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('myVouchers.empty')}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('myVouchers.emptyHint')}</p>
        </div>
      )}

      {!loading && vouchers.length > 0 && (
        <ul className="space-y-3" role="list">
          {vouchers.map(v => (
            <li key={v.id}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white font-mono">
                    {v.code}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {t('myVouchers.expires', { date: fmtDate(v.validityEnd) })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${STATUS_CLS[v.status]}`}>
                    {t(`vouchers.status.${v.status}`)}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {t(`vouchers.origin.${v.origin}` as const) || v.origin} · {t(`vouchers.scope.${v.usageScope}` as const) || v.usageScope}
                </span>
                <span className="font-mono text-base font-semibold text-amber-700 dark:text-amber-300">
                  {v.amount.toLocaleString()} {v.currency}
                </span>
              </div>
              {v.status === 'ISSUED' && (
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  {t('myVouchers.howToUse')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
