/**
 * PageSellTicket — Vente de billet par l'agent de gare
 *
 * Flux :
 *   1. Sélection d'un trajet (OPEN/BOARDING)
 *   2. Chargement de la route → liste des gares ordonnées
 *   3. Saisie passager + options (classe, siège, bagages…)
 *   4. "Calculer le prix" → POST /tickets → affichage tarif
 *   5. Si prix auto-calculé → avertissement + champ éditable + sauvegarde segment
 *   6. "Confirmer et imprimer" → POST /tickets/:id/confirm
 */

import { useState, useMemo } from 'react';
import {
  Ticket, Calculator, CheckCircle2, AlertTriangle, Loader2, Printer,
} from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
import { Button }     from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import { useI18n } from '../../lib/i18n/useI18n';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Station {
  id:   string;
  name: string;
}

interface Waypoint {
  id:       string;
  order:    number;
  station:  Station;
}

interface RouteDetail {
  id:          string;
  name:        string;
  origin:      Station;
  destination: Station;
  waypoints:   Waypoint[];
}

interface Trip {
  id:            string;
  reference?:    string | null;
  departureTime: string;
  routeId:       string;
  routeName?:    string | null;
  status:        string;
}

type FareClass = 'STANDARD' | 'CONFORT' | 'VIP' | 'STANDING';

interface PricingResult {
  ticket: { id: string; [key: string]: unknown };
  pricing: {
    basePrice:       number;
    taxes:           number;
    tolls:           number;
    luggageFee:      number;
    yieldSurplus:    number;
    discount:        number;
    total:           number;
    currency:        string;
    fareClass:       string;
    segmentLabel:    string;
    isAutoCalculated: boolean;
    segmentCharges?: unknown;
    warnings:        string[];
    breakdown?:      Record<string, unknown>;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────


const FARE_OPTIONS: { value: FareClass; labelKey: string }[] = [
  { value: 'STANDARD', labelKey: 'sellTicket.fareStandard' },
  { value: 'CONFORT',  labelKey: 'sellTicket.fareConfort' },
  { value: 'VIP',      labelKey: 'sellTicket.fareVip' },
  { value: 'STANDING', labelKey: 'sellTicket.fareStanding' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount);
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PageSellTicket() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  // ── Trip list ──
  const { data: trips, loading: loadingTrips, error: tripsError } = useFetch<Trip[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?status=OPEN&status=BOARDING` : null,
    [tenantId],
  );

  // ── Selected trip + route ──
  const [selectedTripId, setSelectedTripId] = useState('');
  const [route, setRoute]                   = useState<RouteDetail | null>(null);
  const [loadingRoute, setLoadingRoute]     = useState(false);

  // ── Form fields ──
  const [passengerName,     setPassengerName]     = useState('');
  const [passengerPhone,    setPassengerPhone]    = useState('');
  const [fareClass,         setFareClass]         = useState<FareClass>('STANDARD');
  const [boardingStationId, setBoardingStationId] = useState('');
  const [alightingStationId, setAlightingStationId] = useState('');
  const [seatNumber,        setSeatNumber]        = useState('');
  const [luggageKg,         setLuggageKg]         = useState('');
  const [discountCode,      setDiscountCode]      = useState('');
  const [paymentMethod,     setPaymentMethod]     = useState('');

  // ── Pricing state ──
  const [pricingResult, setPricingResult]   = useState<PricingResult | null>(null);
  const [editablePrice, setEditablePrice]   = useState('');
  const [loadingPrice,  setLoadingPrice]    = useState(false);
  const [savingPrice,   setSavingPrice]     = useState(false);
  const [confirming,    setConfirming]      = useState(false);
  const [confirmed,     setConfirmed]       = useState(false);
  const [error,         setError]           = useState<string | null>(null);

  // ── Build ordered station list from route ──
  const stations = useMemo<Station[]>(() => {
    if (!route) return [];
    const sorted = [...route.waypoints].sort((a, b) => a.order - b.order);
    return [
      route.origin,
      ...sorted.map(wp => wp.station),
      route.destination,
    ];
  }, [route]);

  // ── Alighting options: only stations after boarding ──
  const alightingOptions = useMemo(() => {
    if (!stations.length || !boardingStationId) return stations.slice(1);
    const idx = stations.findIndex(s => s.id === boardingStationId);
    return idx >= 0 ? stations.slice(idx + 1) : [];
  }, [stations, boardingStationId]);

  // ── Handlers ──

  async function handleTripChange(tripId: string) {
    setSelectedTripId(tripId);
    setPricingResult(null);
    setConfirmed(false);
    setError(null);
    setRoute(null);
    setBoardingStationId('');
    setAlightingStationId('');

    if (!tripId) return;

    const trip = trips?.find(t => t.id === tripId);
    if (!trip) return;

    setLoadingRoute(true);
    try {
      const r = await apiGet<RouteDetail>(`/api/tenants/${tenantId}/routes/${trip.routeId}`);
      setRoute(r);
      // Default boarding = origin
      if (r.origin) setBoardingStationId(r.origin.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket LIamAudit.errorLoadRoute'));
    } finally {
      setLoadingRoute(false);
    }
  }

  async function handleCalculatePrice() {
    setLoadingPrice(true);
    setError(null);
    setPricingResult(null);
    setConfirmed(false);

    try {
      const dto: Record<string, unknown> = {
        tripId: selectedTripId,
        passengerName:  passengerName.trim(),
        passengerPhone: passengerPhone.trim(),
        fareClass,
        alightingStationId,
      };
      if (boardingStationId)  dto.boardingStationId  = boardingStationId;
      if (seatNumber.trim())  dto.seatNumber         = seatNumber.trim();
      if (luggageKg)          dto.luggageKg           = Number(luggageKg);
      if (discountCode.trim()) dto.discountCode       = discountCode.trim();
      if (paymentMethod.trim()) dto.paymentMethod     = paymentMethod.trim();

      const result = await apiPost<PricingResult>(`/api/tenants/${tenantId}/tickets`, dto);
      setPricingResult(result);
      if (result.pricing.isAutoCalculated) {
        setEditablePrice(String(result.pricing.total));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket LIamAudit.errorCalc'));
    } finally {
      setLoadingPrice(false);
    }
  }

  async function handleSaveSegmentPrice() {
    if (!pricingResult || !route) return;
    setSavingPrice(true);
    setError(null);
    try {
      await apiPatch(`/api/tenants/${tenantId}/routes/${route.id}/segment-prices`, {
        boardingStationId:  boardingStationId || undefined,
        alightingStationId,
        fareClass,
        price: Number(editablePrice),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket LIamAudit.errorSaveFare'));
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleConfirm() {
    if (!pricingResult) return;
    setConfirming(true);
    setError(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/tickets/${pricingResult.ticket.id}/confirm`);
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket LIamAudit.errorConfirm'));
    } finally {
      setConfirming(false);
    }
  }

  function handleReset() {
    setSelectedTripId('');
    setRoute(null);
    setPassengerName('');
    setPassengerPhone('');
    setFareClass('STANDARD');
    setBoardingStationId('');
    setAlightingStationId('');
    setSeatNumber('');
    setLuggageKg('');
    setDiscountCode('');
    setPaymentMethod('');
    setPricingResult(null);
    setConfirmed(false);
    setError(null);
  }

  const canCalculate =
    selectedTripId && passengerName.trim() && passengerPhone.trim() && alightingStationId;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900/40">
          <Ticket className="w-6 h-6 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
            {t('sellTicket LIamAudit.pageTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('sellTicket LIamAudit.pageDesc')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error ?? tripsError} icon />

      {/* Success state */}
      {confirmed && pricingResult && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {t('sellTicket LIamAudit.ticketConfirmed')}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {pricingResult.pricing.segmentLabel} — {passengerName}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {formatCurrency(pricingResult.pricing.total, pricingResult.pricing.currency)}
            </p>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" leftIcon={<Printer className="w-4 h-4" />}>
                {t('sellTicket LIamAudit.print')}
              </Button>
              <Button onClick={handleReset}>
                {t('sellTicket LIamAudit.newTicket')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main layout */}
      {!confirmed && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* ── Left column: form ── */}
          <div className="lg:col-span-3 space-y-5">
            {/* Trip selector */}
            <Card>
              <CardHeader heading={t('sellTicket LIamAudit.tripSection')} />
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('sellTicket LIamAudit.selectTrip')}
                  </label>
                  <select
                    className={inputClass}
                    value={selectedTripId}
                    onChange={e => handleTripChange(e.target.value)}
                    disabled={loadingTrips}
                  >
                    <option value="">
                      {loadingTrips ? t('sellTicket LIamAudit.loadingTrips') : t('sellTicket LIamAudit.chooseTrip')}
                    </option>
                    {trips?.map(trip => (
                      <option key={trip.id} value={trip.id}>
                        {formatDate(trip.departureTime)} {formatTime(trip.departureTime)}
                        {' — '}
                        {trip.routeName ?? trip.reference ?? trip.id.slice(0, 8)}
                        {' '}
                        ({trip.status})
                      </option>
                    ))}
                  </select>
                </div>
                {loadingRoute && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t('sellTicket LIamAudit.loadingRoute')}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Passenger + options */}
            {route && (
              <Card>
                <CardHeader heading={t('sellTicket LIamAudit.passengerSection')} />
                <CardContent className="space-y-4">
                  {/* Name + Phone */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.passengerName')}
                      </label>
                      <input
                        className={inputClass}
                        placeholder={t('sellTicket LIamAudit.namePlaceholder')}
                        value={passengerName}
                        onChange={e => setPassengerName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.phone')}
                      </label>
                      <input
                        className={inputClass}
                        placeholder="+237 6XX XXX XXX"
                        value={passengerPhone}
                        onChange={e => setPassengerPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Fare class */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t('sellTicket LIamAudit.fareClass')}
                    </label>
                    <select
                      className={inputClass}
                      value={fareClass}
                      onChange={e => setFareClass(e.target.value as FareClass)}
                    >
                      {FARE_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                      ))}
                    </select>
                  </div>

                  {/* Stations */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.boardingStation')}
                      </label>
                      <select
                        className={inputClass}
                        value={boardingStationId}
                        onChange={e => {
                          setBoardingStationId(e.target.value);
                          setAlightingStationId('');
                          setPricingResult(null);
                        }}
                      >
                        {stations.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.alightingStation')}
                      </label>
                      <select
                        className={inputClass}
                        value={alightingStationId}
                        onChange={e => {
                          setAlightingStationId(e.target.value);
                          setPricingResult(null);
                        }}
                      >
                        <option value="">{t('sellTicket LIamAudit.selectStation')}</option>
                        {alightingOptions.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Optional fields */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.seatNumber')}
                      </label>
                      <input
                        className={inputClass}
                        placeholder="ex: 12A"
                        value={seatNumber}
                        onChange={e => setSeatNumber(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.luggageKg')}
                      </label>
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="0"
                        value={luggageKg}
                        onChange={e => setLuggageKg(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket LIamAudit.promoCode')}
                      </label>
                      <input
                        className={inputClass}
                        placeholder="ex: PROMO20"
                        value={discountCode}
                        onChange={e => setDiscountCode(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Payment method */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {t('sellTicket LIamAudit.paymentMethod')}
                    </label>
                    <select
                      className={inputClass}
                      value={paymentMethod}
                      onChange={e => setPaymentMethod(e.target.value)}
                    >
                      <option value="">{t('sellTicket LIamAudit.payDefault')}</option>
                      <option value="CASH">{t('sellTicket LIamAudit.payCash')}</option>
                      <option value="MOBILE_MONEY">{t('sellTicket LIamAudit.payMobile')}</option>
                      <option value="CARD">{t('sellTicket LIamAudit.payCard')}</option>
                    </select>
                  </div>

                  {/* Calculate button */}
                  <div className="pt-2">
                    <Button
                      onClick={handleCalculatePrice}
                      disabled={!canCalculate || loadingPrice}
                      loading={loadingPrice}
                      leftIcon={<Calculator className="w-4 h-4" />}
                    >
                      {t('sellTicket LIamAudit.calculatePrice')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right column: pricing summary ── */}
          <div className="lg:col-span-2 space-y-5">
            {!pricingResult && !loadingPrice && (
              <Card>
                <CardContent className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                  <Ticket className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {t('sellTicket LIamAudit.fillFormHint')}
                  <br />
                  <span className="font-medium">"{t('sellTicket LIamAudit.calculatePrice')}"</span>
                </CardContent>
              </Card>
            )}

            {loadingPrice && (
              <Card>
                <CardContent className="py-12 flex flex-col items-center gap-3 text-sm text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
                  {t('sellTicket LIamAudit.calculating')}
                </CardContent>
              </Card>
            )}

            {pricingResult && (
              <>
                {/* Auto-calculated warning */}
                {pricingResult.pricing.isAutoCalculated && (
                  <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-sm text-amber-800 dark:text-amber-300">
                        <p className="font-semibold">{t('sellTicket LIamAudit.autoPrice')}</p>
                        {pricingResult.pricing.warnings.map((w, i) => (
                          <p key={i} className="mt-1">{w}</p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">
                        {t('sellTicket LIamAudit.correctedPrice')}
                      </label>
                      <input
                        className={inputClass}
                        type="number"
                        min="0"
                        step="100"
                        value={editablePrice}
                        onChange={e => setEditablePrice(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="amber"
                      size="sm"
                      onClick={handleSaveSegmentPrice}
                      loading={savingPrice}
                      disabled={savingPrice}
                    >
                      {t('sellTicket LIamAudit.validateFare')}
                    </Button>
                  </div>
                )}

                {/* Price card */}
                <Card className={
                  pricingResult.pricing.isAutoCalculated
                    ? 'border-amber-300 dark:border-amber-700'
                    : 'border-green-300 dark:border-green-700'
                }>
                  <CardHeader
                    heading={t('sellTicket LIamAudit.priceSummary')}
                    description={pricingResult.pricing.segmentLabel}
                  />
                  <CardContent className="space-y-3">
                    <PriceLine label={t('sellTicket LIamAudit.basePrice')} amount={pricingResult.pricing.basePrice} currency={pricingResult.pricing.currency} />
                    {pricingResult.pricing.taxes > 0 && (
                      <PriceLine label={t('sellTicket LIamAudit.taxes')} amount={pricingResult.pricing.taxes} currency={pricingResult.pricing.currency} />
                    )}
                    {pricingResult.pricing.tolls > 0 && (
                      <PriceLine label={t('sellTicket LIamAudit.tolls')} amount={pricingResult.pricing.tolls} currency={pricingResult.pricing.currency} />
                    )}
                    {pricingResult.pricing.luggageFee > 0 && (
                      <PriceLine label={t('sellTicket LIamAudit.luggageSurcharge')} amount={pricingResult.pricing.luggageFee} currency={pricingResult.pricing.currency} />
                    )}
                    {pricingResult.pricing.yieldSurplus > 0 && (
                      <PriceLine label={t('sellTicket LIamAudit.yieldSurplus')} amount={pricingResult.pricing.yieldSurplus} currency={pricingResult.pricing.currency} />
                    )}
                    {pricingResult.pricing.discount > 0 && (
                      <PriceLine label={t('sellTicket LIamAudit.discount')} amount={-pricingResult.pricing.discount} currency={pricingResult.pricing.currency} discount />
                    )}

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between items-baseline">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('sellTicket LIamAudit.total')}</span>
                      <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                        {formatCurrency(pricingResult.pricing.total, pricingResult.pricing.currency)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      {t('sellTicket LIamAudit.classLabel')} : {pricingResult.pricing.fareClass}
                    </p>
                  </CardContent>
                </Card>

                {/* Confirm button */}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleConfirm}
                  loading={confirming}
                  disabled={confirming}
                  leftIcon={<Printer className="w-5 h-5" />}
                >
                  {t('sellTicket LIamAudit.confirmAndPrint')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component ──────────────────────────────────────────────────────────

function PriceLine({ label, amount, currency, discount }: {
  label: string;
  amount: number;
  currency: string;
  discount?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600 dark:text-slate-400">{label}</span>
      <span className={discount ? 'text-green-600 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'}>
        {discount ? '- ' : ''}{formatCurrency(Math.abs(amount), currency)}
      </span>
    </div>
  );
}
