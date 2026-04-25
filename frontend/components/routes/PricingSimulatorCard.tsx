/**
 * PricingSimulatorCard — Simulateur "prix souhaité" + rentabilité live.
 *
 * UX :
 *   1. Sélection d'un bus du tenant (doit avoir un BusCostProfile).
 *   2. Saisie d'un prix cible (par défaut = basePrice de la ligne).
 *   3. 3 appels parallèles à `POST /simulate-trip` avec fillRate = 0.5 / 0.7 / 0.9
 *      → tableau de rentabilité à 3 lignes.
 *   4. Affichage de la recommandation synthèse (primaryMessage) + break-even.
 *
 * Permission : `data.profitability.read.tenant` (TENANT_ADMIN, AGENCY_MANAGER,
 * ACCOUNTANT). Le composant ne vérifie pas la permission lui-même — l'API renvoie
 * 403 si non autorisé ; le parent (PageRoutes) peut masquer le composant si besoin.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Calculator, TrendingUp, TrendingDown, Scale, Loader2, AlertTriangle } from 'lucide-react';
import { apiPost } from '../../lib/api';
import { useFetch } from '../../lib/hooks/useFetch';
import { useI18n } from '../../lib/i18n/useI18n';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface BusRow {
  id:          string;
  plateNumber: string;
  model:       string | null;
  capacity:    number;
}

interface SimulateResponse {
  input: { routeId: string; busId: string; ticketPrice: number; fillRate: number };
  costs: { totalVariableCost: number; totalFixedCost: number; totalCost: number };
  projected: {
    totalSeats:            number;
    bookedSeats:           number;
    ticketPrice:           number;
    fillRate:              number;
    totalRevenue:          number;
    operationalMargin:     number;
    netMargin:             number;
    netMarginRate:         number;
    breakEvenSeats:        number;
    profitabilityTag:      'PROFITABLE' | 'BREAK_EVEN' | 'DEFICIT';
  };
  recommendations: {
    breakEvenPriceAtFillRate:    number | null;
    profitablePriceAtFillRate:   number | null;
    breakEvenFillRateAtPrice:    number | null;
    profitableFillRateAtPrice:   number | null;
    breakEvenSeatsAtPrice:       number | null;
    profitabilityThresholdPct:   number;
    primaryMessage:              string;
  };
}

interface Props {
  tenantId:   string;
  routeId:    string;
  basePrice:  number;
  currency:   string;
}

/** Taux d'occupation testés par le tableau de rentabilité (zéro magic number :
 *  valeurs de simulation métier classiques — pas des seuils tenant configurables). */
const SIM_FILL_RATES = [0.5, 0.7, 0.9] as const;

function tagBadge(tag: SimulateResponse['projected']['profitabilityTag'], t: (k: string) => string) {
  if (tag === 'PROFITABLE') return <Badge variant="success">{t('routes.simulator.tagProfitable')}</Badge>;
  if (tag === 'BREAK_EVEN') return <Badge variant="warning">{t('routes.simulator.tagBreakEven')}</Badge>;
  return <Badge variant="danger">{t('routes.simulator.tagDeficit')}</Badge>;
}

function tagIcon(tag: SimulateResponse['projected']['profitabilityTag']) {
  if (tag === 'PROFITABLE') return <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" aria-hidden />;
  if (tag === 'BREAK_EVEN') return <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400" aria-hidden />;
  return <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden />;
}

export function PricingSimulatorCard({ tenantId, routeId, basePrice, currency }: Props) {
  const { t } = useI18n();
  const { data: buses } = useFetch<BusRow[]>(
    tenantId ? `/api/tenants/${tenantId}/fleet/buses` : null,
  );

  const [busId,       setBusId]       = useState<string>('');
  const [targetPrice, setTargetPrice] = useState<string>(String(basePrice));
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [rows,        setRows]        = useState<SimulateResponse[]>([]);

  const formatter = useMemo(
    () => new Intl.NumberFormat('fr-FR', { style: 'decimal', maximumFractionDigits: 0 }),
    [],
  );
  const fmt = (n: number) => `${formatter.format(n)} ${currency}`;

  async function handleSimulate(e?: FormEvent) {
    e?.preventDefault();
    if (!busId) {
      setError(t('routes.simulator.errBusRequired'));
      return;
    }
    const price = Number(targetPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setError(t('routes.simulator.errPriceInvalid'));
      return;
    }
    setLoading(true); setError(null); setRows([]);
    try {
      const results = await Promise.all(
        SIM_FILL_RATES.map(fr =>
          apiPost<SimulateResponse>(
            `/api/tenants/${tenantId}/simulate-trip`,
            { routeId, busId, ticketPrice: price, fillRate: fr },
          ),
        ),
      );
      setRows(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('routes.simulator.errGeneric'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <fieldset className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-3">
      <legend className="px-2 text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
        <Calculator className="w-4 h-4" aria-hidden />
        <span>{t('routes.simulator.title')}</span>
      </legend>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('routes.simulator.help')}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 items-end">
        <label className="block">
          <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
            {t('routes.simulator.bus')} <span aria-hidden className="text-red-500">*</span>
          </span>
          <select
            value={busId}
            onChange={e => setBusId(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            disabled={loading}
            required
          >
            <option value="">{t('routes.simulator.selectBus')}</option>
            {(buses ?? []).map(b => (
              <option key={b.id} value={b.id}>
                {b.plateNumber} {b.model ? `— ${b.model}` : ''} ({b.capacity} {t('routes.simulator.seats')})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
            {t('routes.simulator.targetPrice')} ({currency})
          </span>
          <input
            type="number" min={0} step="50"
            value={targetPrice}
            onChange={e => setTargetPrice(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            disabled={loading}
          />
        </label>
        <Button type="button" onClick={() => void handleSimulate()} disabled={loading || !busId}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" aria-hidden />}
          <span className="ml-1.5">{loading ? t('routes.simulator.simulating') : t('routes.simulator.simulate')}</span>
        </Button>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colOccupancy')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colSeatsBooked')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colRevenue')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colCost')}
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colMargin')}
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                    {t('routes.simulator.colTag')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {tagIcon(r.projected.profitabilityTag)}
                      {Math.round(r.projected.fillRate * 100)}%
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {r.projected.bookedSeats} / {r.projected.totalSeats}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {fmt(r.projected.totalRevenue)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                      {fmt(r.costs.totalCost)}
                    </td>
                    <td className={`px-3 py-2 text-right font-semibold ${
                      r.projected.netMargin >= 0
                        ? 'text-green-700 dark:text-green-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}>
                      {r.projected.netMargin >= 0 ? '+' : ''}{fmt(r.projected.netMargin)}
                      <span className="block text-xs font-normal text-slate-400">
                        ({r.projected.netMarginRate >= 0 ? '+' : ''}{(r.projected.netMarginRate * 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td className="px-3 py-2">{tagBadge(r.projected.profitabilityTag, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Recommandations — basées sur la ligne 70% (médiane standard) */}
          {rows[1] && (
            <div className="rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-3 text-sm space-y-1">
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {t('routes.simulator.recommendationsTitle')}
              </p>
              <p className="text-slate-600 dark:text-slate-400">{rows[1].recommendations.primaryMessage}</p>
              {rows[1].recommendations.breakEvenPriceAtFillRate != null && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('routes.simulator.breakEvenPriceHint')}{' '}
                  <strong>{fmt(rows[1].recommendations.breakEvenPriceAtFillRate)}</strong>{' '}
                  {t('routes.simulator.at70')}.
                  {rows[1].recommendations.profitablePriceAtFillRate != null && (
                    <>
                      {' · '}{t('routes.simulator.profitablePriceHint')}{' '}
                      <strong>{fmt(rows[1].recommendations.profitablePriceAtFillRate)}</strong>.
                    </>
                  )}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
