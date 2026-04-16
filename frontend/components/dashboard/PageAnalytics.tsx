/**
 * PageAnalytics — Tableaux analytiques (graphiques par période)
 *
 * Future intégration : GET /api/v1/tenants/:id/analytics/weekly
 */
import { Users, Ticket, Package, Loader2 } from 'lucide-react';
import { MiniBarChart } from './MiniBarChart';
import type { ChartPoint } from './types';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth }  from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTenantConfig } from '../../providers/TenantConfigProvider';


interface SegmentationData {
  total:         number;
  active:        number;
  inactive:      number;
  travelersOnly: number;
  shippersOnly:  number;
  both:          number;
}

// ─── Données mock ─────────────────────────────────────────────────────────────

const REVENUE_7D: ChartPoint[] = [
  { label: 'Lun', value: 5.2 }, { label: 'Mar', value: 6.8 }, { label: 'Mer', value: 4.9 },
  { label: 'Jeu', value: 7.1 }, { label: 'Ven', value: 8.4 }, { label: 'Sam', value: 9.2 },
  { label: 'Dim', value: 6.7 },
];

const PASSENGERS_BY_LINE: ChartPoint[] = [
  { label: 'BZV↔PNR', value: 42 }, { label: 'BZV↔DOL', value: 28 },
  { label: 'BZV↔NKY', value: 18 }, { label: 'PNR↔DOL', value: 14 },
  { label: 'BZV↔OUE', value: 9  },
];

// ─── Sous-composant : Segmentation Clients ────────────────────────────────────
// Source backend : GET /analytics/customer-segmentation. La distinction
// voyageur/expéditeur ne se base PAS sur le rôle (CUSTOMER unifié) mais sur
// l'activité observée (Ticket.passengerId / Parcel.senderId).

function CustomerSegmentationWidget() {
  const { user } = useAuth();
  const { t } = useI18n();
  const url = user?.tenantId ? `/api/tenants/${user.tenantId}/analytics/customer-segmentation` : null;
  const { data, loading, error } = useFetch<SegmentationData>(url, [user?.tenantId]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-4 h-4 text-teal-400" aria-hidden />
        <h3 className="text-sm font-semibold text-white">{t('analytics.segTitle')}</h3>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-slate-500 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">{t('analytics.loading')}</span>
        </div>
      )}
      {error && <p className="text-xs text-red-400 py-2">{error}</p>}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="text-slate-400">{t('analytics.totalCustomers')}</p>
            <p className="text-lg font-bold text-white">{data.total.toLocaleString('fr-FR')}</p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-3 py-2">
            <p className="text-slate-400">{t('analytics.active')}</p>
            <p className="text-lg font-bold text-white">{data.active.toLocaleString('fr-FR')}</p>
            <p className="text-[10px] text-slate-500">{data.inactive.toLocaleString('fr-FR')} {t('analytics.inactive')}</p>
          </div>
          <div className="rounded-lg bg-teal-900/30 border border-teal-800/40 px-3 py-2">
            <Ticket className="w-3 h-3 text-teal-400 inline mb-0.5" aria-hidden />
            <span className="text-teal-300 ml-1">{t('analytics.travelersOnly')}</span>
            <p className="text-lg font-bold text-white">{data.travelersOnly.toLocaleString('fr-FR')}</p>
          </div>
          <div className="rounded-lg bg-orange-900/30 border border-orange-800/40 px-3 py-2">
            <Package className="w-3 h-3 text-orange-400 inline mb-0.5" aria-hidden />
            <span className="text-orange-300 ml-1">{t('analytics.shippersOnly')}</span>
            <p className="text-lg font-bold text-white">{data.shippersOnly.toLocaleString('fr-FR')}</p>
          </div>
          <div className="sm:col-span-2 rounded-lg bg-violet-900/30 border border-violet-800/40 px-3 py-2">
            <span className="text-violet-300">{t('analytics.travelersAndShip')}</span>
            <p className="text-lg font-bold text-white">{data.both.toLocaleString('fr-FR')}</p>
            <p className="text-[10px] text-slate-400">
              {t('analytics.crossSellHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function PageAnalytics() {
  const { operational } = useTenantConfig();
  const { t } = useI18n();
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">{t('analytics.title')}</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label={`${t('analytics.revenueLast7')} (${operational.currencySymbol} ×1M)`}
            data={REVENUE_7D}
          />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <MiniBarChart
            label={t('analytics.paxByLine')}
            data={PASSENGERS_BY_LINE}
          />
        </div>
        <CustomerSegmentationWidget />
      </div>
    </div>
  );
}
