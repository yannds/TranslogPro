/**
 * PageCashier — Vue caisse du jour (données mock)
 *
 * Future intégration : GET /api/v1/tenants/:id/cashier/summary
 */
import { cn }                                      from '../../lib/utils';
import { useI18n }                             from '../../lib/i18n/useI18n';
import type { CashierTransaction } from './types';
import { useTenantConfig } from '../../providers/TenantConfigProvider';


// ─── Données mock ─────────────────────────────────────────────────────────────

const TRANSACTIONS: CashierTransaction[] = [
  { time: '14:20', op: 'Vente billet BZV→PNR — M. Loemba',    montant: '+8 500', ok: true  },
  { time: '14:18', op: 'Vente billet BZV→DOL — Mme Nzinga',   montant: '+5 200', ok: true  },
  { time: '14:10', op: 'Remboursement #1281 — M. Tchibamba',   montant: '-8 500', ok: false },
  { time: '13:55', op: 'Colis enregistré — Expéditeur Bakala', montant: '+2 500', ok: true  },
  { time: '13:45', op: 'Vente billet BZV→NKY — M. Kimbuta',   montant: '+4 000', ok: true  },
];

const SUMMARY_LINES_KEYS: { tKey: string; value: string; color: string }[] = [
  { tKey: 'cashierDash.ticketSales', value: '1 324 000', color: 'text-emerald-400'       },
  { tKey: 'cashierDash.parcelSales', value: '87 500',    color: 'text-emerald-400'       },
  { tKey: 'cashierDash.refunds',     value: '-163 000',  color: 'text-red-400'           },
  { tKey: 'cashierDash.net',         value: '1 248 500', color: 'text-white font-bold'   },
];

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageCashier() {
  const { operational } = useTenantConfig();
  const { t } = useI18n();
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold text-white">{t('cashierDash.title')}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Transactions */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm">Caisse #2 — ouverture 08:00</p>
              <p className="text-3xl font-black text-white tabular-nums mt-1">
                1 248 500 <span className="text-sm font-normal text-slate-500">{operational.currencySymbol}</span>
              </p>
            </div>
            <button className="bg-red-900/40 hover:bg-red-800/60 text-red-400 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              {t('cashierDash.closeCashier')}
            </button>
          </div>

          <div className="border-t border-slate-800 pt-4 space-y-2">
            {TRANSACTIONS.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1">
                <div className="flex items-center gap-3">
                  <span className="text-slate-600 tabular-nums w-12 shrink-0">{t.time}</span>
                  <span className="text-slate-300">{t.op}</span>
                </div>
                <span className={cn('tabular-nums font-semibold shrink-0', t.ok ? 'text-emerald-400' : 'text-red-400')}>
                  {t.montant}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Résumé */}
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              {t('cashierDash.daySummary')}
            </p>
            {SUMMARY_LINES_KEYS.map((r, i) => (
              <div key={i} className="flex justify-between py-1.5 border-b border-slate-800 last:border-0 text-sm">
                <span className="text-slate-400">{t(r.tKey)}</span>
                <span className={cn('tabular-nums', r.color)}>{r.value} {operational.currencySymbol}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
