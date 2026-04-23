/**
 * PagePricingSimulator — Simulateur tarifaire avancé (aide à la décision).
 *
 * Route : /admin/pricing/simulator
 * Permission : `data.profitability.read.tenant` (héritée du controller back).
 *
 * 8 blocs décisionnels :
 *   A. Matrice de sensibilité prix × fillRate (heatmap)
 *   B. Bandes de prix recommandées (min-viable / break-even / profitable / premium)
 *   C. Benchmark historique réel de la ligne (30/90 jours)
 *   D. Analyse concurrence (saisie prix concurrent → verdict)
 *   E. What-if : sliders fuel / commission
 *   F. Comparaison inter-lignes (classement portefeuille)
 *   G. Point mort mensuel (nb voyages/mois)
 *   H. Export PDF via window.print (CSS print-friendly @media print)
 *
 * Endpoints back : POST /api/v1/tenants/:tid/simulator/{matrix|bands|historical|
 *   competitor|what-if|compare-routes|monthly-break-even}
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Calculator, TrendingUp, TrendingDown, Scale, Activity, Target,
  AlertTriangle, Loader2, Download, ArrowRight, Bus, MapPin, Settings2,
} from 'lucide-react';
import { apiPost } from '../../lib/api';
import { useFetch } from '../../lib/hooks/useFetch';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

// ─── Types d'échange (miroirs back) ──────────────────────────────────────────

interface RouteRow { id: string; name: string; distanceKm: number; basePrice: number }
interface BusRow   { id: string; plateNumber: string; model: string | null; capacity: number }

interface MatrixCell {
  ticketPrice: number; fillRate: number;
  netMargin: number; netMarginRate: number;
  profitabilityTag: 'PROFITABLE' | 'BREAK_EVEN' | 'DEFICIT';
}
interface MatrixResponse {
  prices: number[]; fillRates: number[];
  cells: MatrixCell[][]; totalSeats: number;
}
interface BandsResponse {
  bands: {
    minViable:  { price: number; label: string; description: string };
    breakEven:  { price: number; label: string; description: string };
    profitable: { price: number; label: string; description: string };
    premium:    { price: number; label: string; description: string };
  };
  assumptions: { totalCost: number; totalSeats: number; commissionRate: number; breakEvenThresholdPct: number };
}
interface HistoricalResponse {
  summary: {
    tripCount: number;
    avgFillRate: number | null; avgTicketPrice: number | null;
    avgNetMargin: number | null; avgNetMarginRate: number | null;
  };
  series: Array<{
    date: string; fillRate: number; ticketPrice: number;
    netMargin: number; netMarginRate: number; profitabilityTag: string;
  }>;
}
interface CompetitorResponse {
  ownBaseline:     { ticketPrice: number; netMargin: number; netMarginRate: number; profitabilityTag: string };
  competitorMatch: { ticketPrice: number; netMargin: number; netMarginRate: number; profitabilityTag: string };
  requirements:    { breakEvenFillRate: number; profitableFillRate: number; breakEvenSeats: number };
  recommendation:  'MATCH' | 'HOLD' | 'UNDERCUT_PREMIUM' | 'AVOID';
}
interface WhatIfResponse {
  baseline: { totalCost: number; netMargin: number; netMarginRate: number };
  scenario: { totalCost: number; netMargin: number; netMarginRate: number; profitabilityTag: string };
  delta:    { totalCost: number; netMargin: number; netMarginRate: number };
}
interface CompareRow {
  routeId: string; routeName: string; distanceKm: number; basePrice: number;
  netMargin: number | null; netMarginRate: number | null; profitabilityTag: string;
}
interface CompareResponse { routes: CompareRow[]; notice?: string }
interface MonthlyBreakEvenResponse {
  monthlyFixedCost: number;
  perTripNetMarginOnVariable: number;
  tripsPerMonthToBreakEven: number | null;
  currentPlannedTripsPerMonth: number;
  verdict: 'REACHABLE' | 'NEED_MORE_TRIPS' | 'IMPOSSIBLE_AT_THESE_PARAMS';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tagColor(tag: string): string {
  if (tag === 'PROFITABLE') return 'bg-emerald-500/90 text-white';
  if (tag === 'BREAK_EVEN') return 'bg-amber-500/90  text-white';
  if (tag === 'DEFICIT')    return 'bg-red-500/90    text-white';
  return 'bg-slate-400 text-white';
}
function tagTextColor(tag: string): string {
  if (tag === 'PROFITABLE') return 'text-emerald-600 dark:text-emerald-400';
  if (tag === 'BREAK_EVEN') return 'text-amber-600 dark:text-amber-400';
  if (tag === 'DEFICIT')    return 'text-red-600 dark:text-red-400';
  return 'text-slate-500';
}

// ─── Page principale ─────────────────────────────────────────────────────────

export function PagePricingSimulator() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const tenantId = user?.tenantId ?? '';

  // Sélecteurs route + bus + fillRate
  const { data: routes } = useFetch<RouteRow[]>(tenantId ? `/api/tenants/${tenantId}/routes` : null);
  const { data: buses }  = useFetch<BusRow[]>(tenantId ? `/api/tenants/${tenantId}/buses` : null);

  const [routeId, setRouteId] = useState<string>('');
  const [busId,   setBusId]   = useState<string>('');
  const [fillRate, setFillRate] = useState(0.7);

  useEffect(() => { if (!routeId && routes && routes.length > 0) setRouteId(routes[0].id); }, [routes, routeId]);
  useEffect(() => { if (!busId   && buses  && buses.length  > 0) setBusId(buses[0].id);    }, [buses,  busId]);

  const selectedRoute = routes?.find(r => r.id === routeId);
  const selectedBus   = buses?.find(b => b.id === busId);
  const currency = 'XAF';  // TenantConfig provider eût été plus propre — fallback OK pour affichage
  const fmt = useMemo(() => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR'), [lang]);
  const fmtPct = (n: number | null | undefined) =>
    n == null ? '—' : `${(n * 100).toFixed(1)} %`;
  const fmtMoney = (n: number | null | undefined) =>
    n == null ? '—' : `${fmt.format(Math.round(n))} ${currency}`;

  const ready = tenantId && routeId && busId;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <Header onPrint={() => window.print()} />

      <Selector
        routes={routes ?? []} buses={buses ?? []}
        routeId={routeId} setRouteId={setRouteId}
        busId={busId}   setBusId={setBusId}
        fillRate={fillRate} setFillRate={setFillRate}
      />

      {!ready ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('simulator.selectFirst')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 print:grid-cols-1">
          <BlockSensitivityMatrix
            key={`matrix-${routeId}-${busId}`}
            tenantId={tenantId} routeId={routeId} busId={busId}
            currency={currency} fmt={fmt}
          />
          <BlockPriceBands
            key={`bands-${routeId}-${busId}-${fillRate}`}
            tenantId={tenantId} routeId={routeId} busId={busId} fillRate={fillRate}
            fmtMoney={fmtMoney}
          />
          <BlockHistorical
            key={`hist-${routeId}`}
            tenantId={tenantId} routeId={routeId}
            fmtPct={fmtPct} fmtMoney={fmtMoney}
          />
          <BlockCompetitor
            key={`comp-${routeId}-${busId}-${fillRate}`}
            tenantId={tenantId} routeId={routeId} busId={busId} fillRate={fillRate}
            basePrice={selectedRoute?.basePrice ?? 0}
            fmtMoney={fmtMoney} fmtPct={fmtPct}
          />
          <BlockWhatIf
            key={`whatif-${routeId}-${busId}-${fillRate}`}
            tenantId={tenantId} routeId={routeId} busId={busId} fillRate={fillRate}
            basePrice={selectedRoute?.basePrice ?? 0}
            fmtMoney={fmtMoney} fmtPct={fmtPct}
          />
          <BlockMonthlyBreakEven
            key={`be-${routeId}-${busId}-${fillRate}`}
            tenantId={tenantId} routeId={routeId} busId={busId} fillRate={fillRate}
            basePrice={selectedRoute?.basePrice ?? 0}
            fmt={fmt}
          />
          <div className="lg:col-span-2">
            <BlockCompareRoutes tenantId={tenantId} fillRate={fillRate} fmtPct={fmtPct} fmtMoney={fmtMoney} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Header + sélecteur commun ──────────────────────────────────────────────

function Header({ onPrint }: { onPrint: () => void }) {
  const { t } = useI18n();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
          <Calculator className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('simulator.title')}</h1>
          <p className="text-sm t-text-2">{t('simulator.subtitle')}</p>
        </div>
      </div>
      <Button onClick={onPrint} variant="ghost" className="inline-flex items-center gap-1.5">
        <Download className="h-4 w-4" aria-hidden />
        {t('simulator.exportPdf')}
      </Button>
    </header>
  );
}

function Selector({
  routes, buses, routeId, setRouteId, busId, setBusId, fillRate, setFillRate,
}: {
  routes: RouteRow[]; buses: BusRow[];
  routeId: string; setRouteId: (v: string) => void;
  busId: string;   setBusId:   (v: string) => void;
  fillRate: number; setFillRate: (v: number) => void;
}) {
  const { t } = useI18n();
  const inp = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800';
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 print:border-slate-300">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {t('simulator.routeLabel')}
          </label>
          <select value={routeId} onChange={e => setRouteId(e.target.value)} className={inp}>
            {routes.map(r => (
              <option key={r.id} value={r.id}>{r.name} — {r.distanceKm} km</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Bus className="h-3.5 w-3.5" aria-hidden />
            {t('simulator.busLabel')}
          </label>
          <select value={busId} onChange={e => setBusId(e.target.value)} className={inp}>
            {buses.map(b => (
              <option key={b.id} value={b.id}>{b.plateNumber}{b.model ? ` (${b.model})` : ''} — {b.capacity}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            {t('simulator.fillRateLabel')} : <span className="font-semibold">{Math.round(fillRate * 100)} %</span>
          </label>
          <input
            type="range" min={0.1} max={1} step={0.05}
            value={fillRate} onChange={e => setFillRate(Number(e.target.value))}
            className="w-full accent-teal-500"
          />
        </div>
      </div>
    </section>
  );
}

// ─── A. Matrice de sensibilité (heatmap) ────────────────────────────────────

function BlockSensitivityMatrix({
  tenantId, routeId, busId, currency, fmt,
}: {
  tenantId: string; routeId: string; busId: string;
  currency: string; fmt: Intl.NumberFormat;
}) {
  const { t } = useI18n();
  const [data, setData]     = useState<MatrixResponse | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<MatrixResponse>(`/api/v1/tenants/${tenantId}/simulator/sensitivity-matrix`, { routeId, busId })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, routeId, busId]);

  return (
    <BlockCard icon={Target} title={t('simulator.matrix.title')} description={t('simulator.matrix.desc')}>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="px-1 py-1 text-left text-slate-500">{currency}</th>
                {data.fillRates.map(f => (
                  <th key={f} className="px-1 py-1 text-center text-slate-500">{Math.round(f * 100)}%</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cells.map((row, i) => (
                <tr key={i}>
                  <th scope="row" className="px-1 py-1 text-right font-mono text-slate-600 dark:text-slate-400">
                    {fmt.format(data.prices[i])}
                  </th>
                  {row.map((cell, j) => (
                    <td key={j} className={cn('px-1 py-1 text-center', tagColor(cell.profitabilityTag))}>
                      <span className="block text-[10px] font-semibold">
                        {cell.netMargin >= 0 ? '+' : ''}{fmt.format(Math.round(cell.netMargin / 1000))}k
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{t('simulator.matrix.legend')}</p>
        </div>
      )}
    </BlockCard>
  );
}

// ─── B. Bandes de prix recommandées ─────────────────────────────────────────

function BlockPriceBands({
  tenantId, routeId, busId, fillRate, fmtMoney,
}: {
  tenantId: string; routeId: string; busId: string; fillRate: number;
  fmtMoney: (n: number | null | undefined) => string;
}) {
  const { t } = useI18n();
  const [data, setData]     = useState<BandsResponse | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<BandsResponse>(`/api/v1/tenants/${tenantId}/simulator/price-bands`, { routeId, busId, fillRate })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, routeId, busId, fillRate]);

  const bandsList = data ? [data.bands.minViable, data.bands.breakEven, data.bands.profitable, data.bands.premium] : [];

  return (
    <BlockCard icon={TrendingUp} title={t('simulator.bands.title')} description={t('simulator.bands.desc')}>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : (
        <ul className="grid grid-cols-2 gap-3">
          {bandsList.map(b => (
            <li key={b.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/60">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t(`simulator.bands.${b.label}`)}</p>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{fmtMoney(b.price)}</p>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{b.description}</p>
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  );
}

// ─── C. Benchmark historique réel ───────────────────────────────────────────

function BlockHistorical({
  tenantId, routeId, fmtPct, fmtMoney,
}: {
  tenantId: string; routeId: string;
  fmtPct: (n: number | null | undefined) => string;
  fmtMoney: (n: number | null | undefined) => string;
}) {
  const { t } = useI18n();
  const [days, setDays] = useState(90);
  const [data, setData] = useState<HistoricalResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<HistoricalResponse>(`/api/v1/tenants/${tenantId}/simulator/historical-benchmark`, { routeId, days })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, routeId, days]);

  return (
    <BlockCard icon={Activity} title={t('simulator.historical.title')} description={t('simulator.historical.desc')}>
      <div className="flex gap-2 print:hidden">
        {[30, 60, 90].map(d => (
          <button
            key={d} type="button"
            onClick={() => setDays(d)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium',
              days === d
                ? 'bg-teal-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {d} {t('simulator.historical.days')}
          </button>
        ))}
      </div>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : data.summary.tripCount === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('simulator.historical.empty')}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t('simulator.historical.tripCount')} value={String(data.summary.tripCount)} />
            <Stat label={t('simulator.historical.avgFillRate')} value={fmtPct(data.summary.avgFillRate)} />
            <Stat label={t('simulator.historical.avgTicketPrice')} value={fmtMoney(data.summary.avgTicketPrice)} />
            <Stat label={t('simulator.historical.avgNetMargin')} value={fmtMoney(data.summary.avgNetMargin)} />
          </div>
          {/* Mini-bar chart — chaque trip une barre colorée */}
          <div className="flex h-16 items-end gap-px">
            {data.series.map((s, i) => (
              <div
                key={i}
                title={`${new Date(s.date).toLocaleDateString()} — ${fmtMoney(s.netMargin)} — ${s.profitabilityTag}`}
                className={cn('flex-1 min-w-[2px]', tagColor(s.profitabilityTag))}
                style={{ height: `${Math.max(5, Math.abs(s.netMarginRate) * 400)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </BlockCard>
  );
}

// ─── D. Analyse concurrence ─────────────────────────────────────────────────

function BlockCompetitor({
  tenantId, routeId, busId, fillRate, basePrice, fmtMoney, fmtPct,
}: {
  tenantId: string; routeId: string; busId: string; fillRate: number; basePrice: number;
  fmtMoney: (n: number | null | undefined) => string;
  fmtPct:   (n: number | null | undefined) => string;
}) {
  const { t } = useI18n();
  const [competitorPrice, setCompetitorPrice] = useState<number>(Math.round(basePrice * 0.9));
  useEffect(() => { setCompetitorPrice(Math.round(basePrice * 0.9)); }, [basePrice]);

  const [data, setData]   = useState<CompetitorResponse | null>(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (competitorPrice <= 0) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<CompetitorResponse>(
        `/api/v1/tenants/${tenantId}/simulator/analyze-competitor`,
        { routeId, busId, competitorPrice, fillRate },
      );
      setData(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void run(); /* eslint-disable-next-line */ }, [routeId, busId, fillRate]);

  const recoLabel = data ? t(`simulator.competitor.reco_${data.recommendation}`) : '';
  const recoColor = data?.recommendation === 'MATCH'             ? 'bg-emerald-100 text-emerald-800'
                  : data?.recommendation === 'HOLD'              ? 'bg-sky-100 text-sky-800'
                  : data?.recommendation === 'UNDERCUT_PREMIUM'  ? 'bg-amber-100 text-amber-800'
                  :                                                 'bg-red-100 text-red-800';

  return (
    <BlockCard icon={Scale} title={t('simulator.competitor.title')} description={t('simulator.competitor.desc')}>
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {t('simulator.competitor.priceLabel')}
          </label>
          <input
            type="number" min={0} value={competitorPrice}
            onChange={e => setCompetitorPrice(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <Button onClick={run} variant="default" disabled={busy || competitorPrice <= 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {t('simulator.competitor.run')}
        </Button>
      </div>
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="space-y-3">
          <div className={cn('rounded-lg px-3 py-2 text-sm font-semibold dark:bg-opacity-20', recoColor)}>
            {recoLabel}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs text-slate-500">{t('simulator.competitor.yourPrice')}</p>
              <p className="font-semibold">{fmtMoney(data.ownBaseline.ticketPrice)}</p>
              <p className={tagTextColor(data.ownBaseline.profitabilityTag)}>{fmtPct(data.ownBaseline.netMarginRate)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs text-slate-500">{t('simulator.competitor.atCompetitor')}</p>
              <p className="font-semibold">{fmtMoney(data.competitorMatch.ticketPrice)}</p>
              <p className={tagTextColor(data.competitorMatch.profitabilityTag)}>{fmtPct(data.competitorMatch.netMarginRate)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {t('simulator.competitor.requireFillRate').replace('{pct}', fmtPct(data.requirements.breakEvenFillRate))}
          </p>
        </div>
      )}
    </BlockCard>
  );
}

// ─── E. What-if sliders fuel / commission ───────────────────────────────────

function BlockWhatIf({
  tenantId, routeId, busId, fillRate, basePrice, fmtMoney, fmtPct,
}: {
  tenantId: string; routeId: string; busId: string; fillRate: number; basePrice: number;
  fmtMoney: (n: number | null | undefined) => string;
  fmtPct:   (n: number | null | undefined) => string;
}) {
  const { t } = useI18n();
  const [fuelDelta,  setFuelDelta]  = useState(0);
  const [commission, setCommission] = useState<number | null>(null); // null = défaut
  const [data, setData]     = useState<WhatIfResponse | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<WhatIfResponse>(`/api/v1/tenants/${tenantId}/simulator/what-if`, {
      routeId, busId, ticketPrice: basePrice, fillRate,
      fuelDeltaPct: fuelDelta,
      commissionRate: commission ?? undefined,
    })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, routeId, busId, basePrice, fillRate, fuelDelta, commission]);

  return (
    <BlockCard icon={Settings2} title={t('simulator.whatIf.title')} description={t('simulator.whatIf.desc')}>
      <div className="space-y-3 print:hidden">
        <label className="block text-xs">
          <span className="font-medium">{t('simulator.whatIf.fuelDelta')} : <strong>{fuelDelta > 0 ? '+' : ''}{fuelDelta} %</strong></span>
          <input type="range" min={-30} max={50} step={5} value={fuelDelta}
            onChange={e => setFuelDelta(Number(e.target.value))}
            className="mt-1 w-full accent-teal-500" />
        </label>
        <label className="block text-xs">
          <span className="font-medium">{t('simulator.whatIf.commission')} : <strong>{commission == null ? t('simulator.whatIf.commissionDefault') : `${(commission * 100).toFixed(0)} %`}</strong></span>
          <input type="range" min={0} max={0.3} step={0.01}
            value={commission ?? 0.05}
            onChange={e => setCommission(Number(e.target.value))}
            className="mt-1 w-full accent-teal-500" />
          <button
            type="button" onClick={() => setCommission(null)}
            className="mt-1 text-[10px] text-teal-600 hover:underline dark:text-teal-400"
          >{t('simulator.whatIf.resetCommission')}</button>
        </label>
      </div>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label={t('simulator.whatIf.totalCostDelta')} value={`${data.delta.totalCost >= 0 ? '+' : ''}${fmtMoney(data.delta.totalCost)}`} />
          <Stat label={t('simulator.whatIf.netMarginDelta')} value={`${data.delta.netMargin >= 0 ? '+' : ''}${fmtMoney(data.delta.netMargin)}`} />
          <Stat label={t('simulator.whatIf.finalTag')}       value={<Badge variant={data.scenario.profitabilityTag === 'PROFITABLE' ? 'success' : data.scenario.profitabilityTag === 'BREAK_EVEN' ? 'warning' : 'danger'}>{t(`routes.simulator.tag${data.scenario.profitabilityTag === 'PROFITABLE' ? 'Profitable' : data.scenario.profitabilityTag === 'BREAK_EVEN' ? 'BreakEven' : 'Deficit'}`)}</Badge>} />
        </div>
      )}
    </BlockCard>
  );
}

// ─── F. Comparaison inter-lignes ────────────────────────────────────────────

function BlockCompareRoutes({
  tenantId, fillRate, fmtPct, fmtMoney,
}: {
  tenantId: string; fillRate: number;
  fmtPct:   (n: number | null | undefined) => string;
  fmtMoney: (n: number | null | undefined) => string;
}) {
  const { t } = useI18n();
  const [data, setData]     = useState<CompareResponse | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<CompareResponse>(`/api/v1/tenants/${tenantId}/simulator/compare-routes`, { fillRate })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, fillRate]);

  return (
    <BlockCard icon={TrendingDown} title={t('simulator.compareRoutes.title')} description={t('simulator.compareRoutes.desc')}>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : data.notice === 'NO_COST_PROFILE_ANYWHERE' ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{t('simulator.compareRoutes.noProfile')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="px-2 py-1.5 text-left">{t('simulator.compareRoutes.rank')}</th>
                <th className="px-2 py-1.5 text-left">{t('simulator.compareRoutes.route')}</th>
                <th className="px-2 py-1.5 text-right">{t('simulator.compareRoutes.distance')}</th>
                <th className="px-2 py-1.5 text-right">{t('simulator.compareRoutes.basePrice')}</th>
                <th className="px-2 py-1.5 text-right">{t('simulator.compareRoutes.netMargin')}</th>
                <th className="px-2 py-1.5 text-right">{t('simulator.compareRoutes.marginRate')}</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.map((r, i) => (
                <tr key={r.routeId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1.5 font-mono">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium">{r.routeName}</td>
                  <td className="px-2 py-1.5 text-right">{r.distanceKm} km</td>
                  <td className="px-2 py-1.5 text-right">{fmtMoney(r.basePrice)}</td>
                  <td className={cn('px-2 py-1.5 text-right font-semibold', tagTextColor(r.profitabilityTag))}>
                    {fmtMoney(r.netMargin)}
                  </td>
                  <td className={cn('px-2 py-1.5 text-right', tagTextColor(r.profitabilityTag))}>
                    {fmtPct(r.netMarginRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BlockCard>
  );
}

// ─── G. Point mort mensuel ──────────────────────────────────────────────────

function BlockMonthlyBreakEven({
  tenantId, routeId, busId, fillRate, basePrice, fmt,
}: {
  tenantId: string; routeId: string; busId: string; fillRate: number; basePrice: number;
  fmt: Intl.NumberFormat;
}) {
  const { t } = useI18n();
  const [data, setData]     = useState<MonthlyBreakEvenResponse | null>(null);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setBusy(true); setError(null);
    apiPost<MonthlyBreakEvenResponse>(`/api/v1/tenants/${tenantId}/simulator/monthly-break-even`, {
      routeId, busId, ticketPrice: basePrice, fillRate,
    })
      .then(setData)
      .catch(e => setError(String(e)))
      .finally(() => setBusy(false));
  }, [tenantId, routeId, busId, basePrice, fillRate]);

  return (
    <BlockCard icon={Activity} title={t('simulator.monthlyBE.title')} description={t('simulator.monthlyBE.desc')}>
      {busy ? <Spinner /> : error ? <ErrorBox msg={error} /> : !data ? null : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('simulator.monthlyBE.fixedCost')} value={fmt.format(data.monthlyFixedCost)} />
            <Stat label={t('simulator.monthlyBE.perTripMargin')} value={fmt.format(data.perTripNetMarginOnVariable)} />
            <Stat label={t('simulator.monthlyBE.tripsNeeded')} value={data.tripsPerMonthToBreakEven == null ? '∞' : String(data.tripsPerMonthToBreakEven)} />
            <Stat label={t('simulator.monthlyBE.currentPlanned')} value={String(data.currentPlannedTripsPerMonth)} />
          </div>
          <div className={cn('rounded-md p-2 text-xs font-medium',
            data.verdict === 'REACHABLE'     ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200' :
            data.verdict === 'NEED_MORE_TRIPS' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' :
                                               'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
          )}>
            {t(`simulator.monthlyBE.verdict_${data.verdict}`)}
          </div>
        </div>
      )}
    </BlockCard>
  );
}

// ─── Composants génériques internes ─────────────────────────────────────────

function BlockCard({ icon: Icon, title, description, children }: {
  icon: typeof Calculator; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 print:break-inside-avoid">
      <header className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/60">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>…</span>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{msg}</span>
    </div>
  );
}
