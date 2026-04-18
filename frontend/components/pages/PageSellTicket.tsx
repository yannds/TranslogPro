/**
 * PageSellTicket — Vente de billet par l'agent de gare
 *
 * Flux v2 (achat groupé + sièges) :
 *   1. Sélection d'un trajet (OPEN/BOARDING)
 *   2. Chargement route → gares ordonnées + chargement seatmap
 *   3. Saisie multi-passagers (nom, prénom, tél, classe, siège…)
 *   4. "Calculer le prix" → POST /tickets/batch → récap par passager + total
 *   5. Si prix auto-calculé → avertissement + champ éditable + sauvegarde segment
 *   6. "Confirmer et imprimer" → POST /tickets/batch/confirm
 *   7. Écran succès avec impression billets individuels ou facture groupe
 */

import { useState, useMemo } from 'react';
import {
  Ticket, Calculator, CheckCircle2, AlertTriangle, Loader2, Printer,
  UserPlus, X, FileText,
} from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiGet, apiPost, apiPatch } from '../../lib/api';
import { Button }     from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import { useI18n } from '../../lib/i18n/useI18n';
import { CrmPhoneHint } from '../crm/CrmPhoneHint';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { SeatMapPicker } from '../tickets/SeatMapPicker';

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

interface TripItem {
  id:                 string;
  departureScheduled: string;
  routeId:            string;
  status:             string;
  seatingMode?:       string;
  route?: {
    name: string;
    origin?:      { name: string } | null;
    destination?: { name: string } | null;
  } | null;
}

interface SeatInfo {
  seatingMode:      string;
  seatLayout:       { rows: number; cols: number; aisleAfter?: number; disabled?: string[] } | null;
  occupiedSeats:    string[];
  availableCount:   number;
  totalCount:       number;
  soldCount:        number;
  seatSelectionFee: number;
  isFullVip?:       boolean;
  vipSeats?:        string[];
}

type FareClass = 'STANDARD' | 'CONFORT' | 'VIP' | 'STANDING';

interface PassengerRow {
  id:                  string; // client-only key
  passengerName:       string;
  passengerPhone:      string;
  passengerEmail:      string;  // optionnel — alimente le CRM si fourni
  fareClass:           FareClass;
  boardingStationId:   string;
  alightingStationId:  string;
  seatNumber:          string | null;
  wantsSeatSelection:  boolean;
  luggageKg:           string;
}

interface BatchResult {
  tickets: { id: string; passengerName: string; seatNumber?: string | null }[];
  pricingSummary: {
    perTicket: {
      ticketId:      string;
      passengerName: string;
      seatNumber:    string | null;
      total:         number;
      fareClass:     string;
      currency:      string;
    }[];
    grandTotal: number;
    currency:   string;
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

let _rowId = 0;
function newPassengerRow(defaults: Partial<PassengerRow> = {}): PassengerRow {
  return {
    id:                  `pr-${++_rowId}`,
    passengerName:       '',
    passengerPhone:      '',
    passengerEmail:      '',
    fareClass:           'STANDARD',
    boardingStationId:   defaults.boardingStationId ?? '',
    alightingStationId:  '',
    seatNumber:          null,
    wantsSeatSelection:  false,
    luggageKg:           '',
    ...defaults,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PageSellTicket() {
  const { user } = useAuth();
  const { t } = useI18n();
  const formatCurrency = useCurrencyFormatter();
  const tenantId = user?.tenantId ?? '';

  // ── Trip list ──
  const { data: trips, loading: loadingTrips, error: tripsError } = useFetch<TripItem[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?status=PLANNED&status=OPEN&status=BOARDING` : null,
    [tenantId],
  );

  // ── Selected trip + route + seats ──
  const [selectedTripId, setSelectedTripId] = useState('');
  const [route, setRoute]                   = useState<RouteDetail | null>(null);
  const [seatInfo, setSeatInfo]             = useState<SeatInfo | null>(null);
  const [loadingRoute, setLoadingRoute]     = useState(false);

  // ── Passengers ──
  const [passengers, setPassengers] = useState<PassengerRow[]>([newPassengerRow()]);

  // ── Shared fields ──
  const [discountCode,  setDiscountCode]  = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');

  // ── Pricing state ──
  const [batchResult, setBatchResult]   = useState<BatchResult | null>(null);
  const [editablePrice, setEditablePrice] = useState('');
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [savingPrice,  setSavingPrice]  = useState(false);
  const [confirming,   setConfirming]   = useState(false);
  const [confirmed,    setConfirmed]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);

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

  // ── Is the current trip numbered seating? ──
  const isNumbered = seatInfo?.seatingMode === 'NUMBERED' && !!seatInfo.seatLayout;

  // ── Collect all selected seats across passengers ──
  const allSelectedSeats = useMemo(() => {
    return passengers
      .filter(p => p.wantsSeatSelection && p.seatNumber)
      .map(p => p.seatNumber!);
  }, [passengers]);

  // ── Combined occupied = backend occupied + locally selected by other passengers ──
  const getOccupiedForPassenger = (passengerId: string) => {
    const base = seatInfo?.occupiedSeats ?? [];
    const others = passengers
      .filter(p => p.id !== passengerId && p.wantsSeatSelection && p.seatNumber)
      .map(p => p.seatNumber!);
    return [...base, ...others];
  };

  // ── Passenger helpers ──

  function updatePassenger(id: string, patch: Partial<PassengerRow>) {
    setPassengers(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    setBatchResult(null);
  }

  function addPassenger() {
    const first = passengers[0];
    setPassengers(prev => [
      ...prev,
      newPassengerRow({
        boardingStationId:  first?.boardingStationId ?? '',
        alightingStationId: first?.alightingStationId ?? '',
        fareClass:          first?.fareClass ?? 'STANDARD',
      }),
    ]);
    setBatchResult(null);
  }

  function removePassenger(id: string) {
    setPassengers(prev => prev.length <= 1 ? prev : prev.filter(p => p.id !== id));
    setBatchResult(null);
  }

  /** Alighting options for a passenger: only stations after their boarding station */
  function getAlightingOptions(boardingId: string): Station[] {
    if (!stations.length || !boardingId) return stations.slice(1);
    const idx = stations.findIndex(s => s.id === boardingId);
    return idx >= 0 ? stations.slice(idx + 1) : [];
  }

  // ── Handlers ──

  async function handleTripChange(tripId: string) {
    setSelectedTripId(tripId);
    setBatchResult(null);
    setConfirmed(false);
    setError(null);
    setRoute(null);
    setSeatInfo(null);
    setPassengers([newPassengerRow()]);

    if (!tripId) return;

    const trip = trips?.find(t => t.id === tripId);
    if (!trip) return;

    setLoadingRoute(true);
    try {
      const [r, seats] = await Promise.all([
        apiGet<RouteDetail>(`/api/tenants/${tenantId}/routes/${trip.routeId}`),
        apiGet<SeatInfo>(`/api/tenants/${tenantId}/trips/${tripId}/seats`),
      ]);
      setRoute(r);
      setSeatInfo(seats);
      if (r.origin) {
        setPassengers([newPassengerRow({ boardingStationId: r.origin.id })]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket.errorLoadRoute'));
    } finally {
      setLoadingRoute(false);
    }
  }

  async function handleCalculatePrice() {
    setLoadingPrice(true);
    setError(null);
    setBatchResult(null);
    setConfirmed(false);

    try {
      const dto = {
        tripId: selectedTripId,
        passengers: passengers.map(p => ({
          passengerName:      p.passengerName.trim(),
          passengerPhone:     p.passengerPhone.trim(),
          passengerEmail:     p.passengerEmail.trim() || undefined,
          fareClass:          p.fareClass,
          boardingStationId:  p.boardingStationId || undefined,
          alightingStationId: p.alightingStationId,
          seatNumber:         p.wantsSeatSelection ? p.seatNumber : undefined,
          wantsSeatSelection: p.wantsSeatSelection || undefined,
          luggageKg:          p.luggageKg ? Number(p.luggageKg) : undefined,
        })),
        discountCode:  discountCode.trim() || undefined,
        paymentMethod: paymentMethod.trim() || undefined,
      };

      const result = await apiPost<BatchResult>(`/api/tenants/${tenantId}/tickets/batch`, dto);
      setBatchResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket.errorCalc'));
    } finally {
      setLoadingPrice(false);
    }
  }

  async function handleSaveSegmentPrice() {
    if (!batchResult || !route || !passengers[0]) return;
    setSavingPrice(true);
    setError(null);
    try {
      const p = passengers[0];
      await apiPatch(`/api/tenants/${tenantId}/routes/${route.id}/segment-prices`, {
        boardingStationId:  p.boardingStationId || undefined,
        alightingStationId: p.alightingStationId,
        fareClass:          p.fareClass,
        price:              Number(editablePrice),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket.errorSaveFare'));
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleConfirm() {
    if (!batchResult) return;
    setConfirming(true);
    setError(null);
    try {
      const ticketIds = batchResult.tickets.map(t => t.id);
      await apiPost(`/api/tenants/${tenantId}/tickets/batch/confirm`, { ticketIds });
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sellTicket.errorConfirm'));
    } finally {
      setConfirming(false);
    }
  }

  function handleReset() {
    setSelectedTripId('');
    setRoute(null);
    setSeatInfo(null);
    setPassengers([newPassengerRow()]);
    setDiscountCode('');
    setPaymentMethod('');
    setBatchResult(null);
    setConfirmed(false);
    setError(null);
  }

  const canCalculate = selectedTripId
    && passengers.every(p => p.passengerName.trim() && p.passengerPhone.trim() && p.alightingStationId);

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
            {t('sellTicket.pageTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('sellTicket.pageDesc')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error ?? tripsError} icon />

      {/* Success state */}
      {confirmed && batchResult && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-green-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {batchResult.tickets.length > 1
                ? t('sellTicket.ticketsConfirmed', { count: String(batchResult.tickets.length) })
                : t('sellTicket.ticketConfirmed')}
            </h2>

            {/* Per-ticket recap */}
            <div className="w-full max-w-md space-y-2 text-left">
              {batchResult.pricingSummary.perTicket.map(pt => (
                <div key={pt.ticketId} className="flex justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-1">
                  <span className="text-slate-700 dark:text-slate-300">
                    {pt.passengerName}
                    {pt.seatNumber && <span className="text-xs text-slate-400 ml-1">({t('sellTicket.seat')} {pt.seatNumber})</span>}
                  </span>
                  <span className="font-medium text-slate-900 dark:text-slate-50">
                    {formatCurrency(pt.total)}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {t('sellTicket.total')}: {formatCurrency(batchResult.pricingSummary.grandTotal)}
            </p>
            <div className="flex gap-3 mt-2">
              <Button variant="outline" leftIcon={<Printer className="w-4 h-4" />}>
                {t('sellTicket.printTickets')}
              </Button>
              {batchResult.tickets.length > 1 && (
                <Button variant="outline" leftIcon={<FileText className="w-4 h-4" />}>
                  {t('sellTicket.printGroupInvoice')}
                </Button>
              )}
              <Button onClick={handleReset}>
                {t('sellTicket.newTicket')}
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
              <CardHeader heading={t('sellTicket.tripSection')} />
              <CardContent className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t('sellTicket.selectTrip')}
                  </label>
                  <select
                    className={inputClass}
                    value={selectedTripId}
                    onChange={e => handleTripChange(e.target.value)}
                    disabled={loadingTrips}
                  >
                    <option value="">
                      {loadingTrips ? t('sellTicket.loadingTrips') : t('sellTicket.chooseTrip')}
                    </option>
                    {trips?.map(trip => (
                      <option key={trip.id} value={trip.id}>
                        {formatDate(trip.departureScheduled)} {formatTime(trip.departureScheduled)}
                        {' — '}
                        {trip.route?.name ?? trip.id.slice(0, 8)}
                        {' '}
                        ({trip.status})
                      </option>
                    ))}
                  </select>
                </div>

                {loadingRoute && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t('sellTicket.loadingRoute')}
                  </div>
                )}

                {/* Availability badge */}
                {seatInfo && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`font-medium ${seatInfo.availableCount > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-red-600 dark:text-red-400'}`}>
                      {seatInfo.availableCount} / {seatInfo.totalCount} {t('sellTicket.seatsRemaining')}
                    </span>
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {seatInfo.seatingMode === 'NUMBERED' ? t('sellTicket.numberedSeating') : t('sellTicket.freeSeating')}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Seat map (NUMBERED mode only) */}
            {isNumbered && seatInfo?.seatLayout && (
              <Card>
                <CardHeader heading={t('sellTicket.seatMapTitle')} description={t('sellTicket.seatMapDesc')} />
                <CardContent>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    {t('sellTicket.seatMapHint')}
                  </p>
                  {/* The seatmap is shown here for reference; individual selection happens per passenger below */}
                  <SeatMapPicker
                    seatLayout={seatInfo.seatLayout}
                    occupiedSeats={[...seatInfo.occupiedSeats, ...allSelectedSeats]}
                    selectedSeat={null}
                    onSelect={() => {}}
                    seatSelectionFee={seatInfo.seatSelectionFee}
                    currency={batchResult?.pricingSummary?.currency}
                    isFullVip={seatInfo.isFullVip}
                    vipSeats={seatInfo.vipSeats}
                    disabled
                  />
                </CardContent>
              </Card>
            )}

            {/* Passengers */}
            {route && (
              <Card>
                <CardHeader
                  heading={t('sellTicket.passengerSection')}
                  description={passengers.length > 1 ? t('sellTicket.groupPurchaseHint', { count: String(passengers.length) }) : undefined}
                />
                <CardContent className="space-y-6">
                  {passengers.map((p, idx) => (
                    <div key={p.id} className="space-y-4">
                      {/* Separator between passengers */}
                      {idx > 0 && (
                        <div className="flex items-center gap-2 pt-2">
                          <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {t('sellTicket.passenger')} {idx + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => removePassenger(p.id)}
                            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-400 hover:text-red-600"
                            title={t('sellTicket.removePassenger')}
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
                        </div>
                      )}

                      {/* Name + Phone + Email (optionnel — CRM) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor={`pn-${p.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.passengerName')}
                            <span aria-hidden className="text-red-600 ml-0.5">*</span>
                          </label>
                          <input
                            id={`pn-${p.id}`}
                            className={inputClass}
                            placeholder={t('sellTicket.namePlaceholder')}
                            value={p.passengerName}
                            onChange={e => updatePassenger(p.id, { passengerName: e.target.value })}
                            required
                          />
                        </div>
                        <div>
                          <label htmlFor={`pp-${p.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.phone')}
                            <span aria-hidden className="text-red-600 ml-0.5">*</span>
                          </label>
                          <input
                            id={`pp-${p.id}`}
                            className={inputClass}
                            placeholder={t('sellTicket.phonePlaceholder')}
                            value={p.passengerPhone}
                            onChange={e => updatePassenger(p.id, { passengerPhone: e.target.value })}
                            required
                          />
                          {/* Phase 4 : hint CRM inline quand le phone matche un Customer existant */}
                          <CrmPhoneHint tenantId={user?.tenantId ?? ''} phone={p.passengerPhone} />
                        </div>
                        <div>
                          <label htmlFor={`pe-${p.id}`} className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.email')}
                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-1 font-normal">
                              {t('common.optional')}
                            </span>
                          </label>
                          <input
                            id={`pe-${p.id}`}
                            type="email"
                            className={inputClass}
                            placeholder={t('sellTicket.emailPlaceholder')}
                            value={p.passengerEmail}
                            onChange={e => updatePassenger(p.id, { passengerEmail: e.target.value })}
                            aria-describedby={`pe-help-${p.id}`}
                          />
                          <p id={`pe-help-${p.id}`} className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            {t('sellTicket.emailHelp')}
                          </p>
                        </div>
                      </div>

                      {/* Fare class + stations */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.fareClass')}
                          </label>
                          <select
                            className={inputClass}
                            value={p.fareClass}
                            onChange={e => updatePassenger(p.id, { fareClass: e.target.value as FareClass })}
                          >
                            {FARE_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.boardingStation')}
                          </label>
                          <select
                            className={inputClass}
                            value={p.boardingStationId}
                            onChange={e => {
                              updatePassenger(p.id, { boardingStationId: e.target.value, alightingStationId: '' });
                            }}
                          >
                            {stations.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.alightingStation')}
                          </label>
                          <select
                            className={inputClass}
                            value={p.alightingStationId}
                            onChange={e => updatePassenger(p.id, { alightingStationId: e.target.value })}
                          >
                            <option value="">{t('sellTicket.selectStation')}</option>
                            {getAlightingOptions(p.boardingStationId).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Seat selection (NUMBERED only) + luggage */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {isNumbered && seatInfo?.seatLayout ? (
                          <>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`seat-opt-${p.id}`}
                                checked={p.wantsSeatSelection}
                                onChange={e => updatePassenger(p.id, {
                                  wantsSeatSelection: e.target.checked,
                                  seatNumber: e.target.checked ? p.seatNumber : null,
                                })}
                                className="rounded border-slate-300 dark:border-slate-600 text-teal-600 focus:ring-teal-500"
                              />
                              <label htmlFor={`seat-opt-${p.id}`} className="text-sm text-slate-700 dark:text-slate-300">
                                {t('sellTicket.chooseSeatOption')}
                                {seatInfo.seatSelectionFee > 0 && (
                                  <span className="text-xs text-amber-600 dark:text-amber-400 ml-1">
                                    (+{formatCurrency(seatInfo.seatSelectionFee)})
                                  </span>
                                )}
                              </label>
                            </div>
                            {p.wantsSeatSelection && (
                              <div className="sm:col-span-2">
                                <SeatMapPicker
                                  seatLayout={seatInfo.seatLayout}
                                  occupiedSeats={getOccupiedForPassenger(p.id)}
                                  selectedSeat={p.seatNumber}
                                  onSelect={seat => updatePassenger(p.id, {
                                    seatNumber: seat === p.seatNumber ? null : seat,
                                  })}
                                  seatSelectionFee={seatInfo.seatSelectionFee}
                                  currency={batchResult?.pricingSummary?.currency}
                                  isFullVip={seatInfo.isFullVip}
                                  vipSeats={seatInfo.vipSeats}
                                />
                              </div>
                            )}
                          </>
                        ) : (
                          <div /> /* spacer */
                        )}
                        <div>
                          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                            {t('sellTicket.luggageKg')}
                          </label>
                          <input
                            className={inputClass}
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder={t('sellTicket.luggagePlaceholder')}
                            value={p.luggageKg}
                            onChange={e => updatePassenger(p.id, { luggageKg: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add passenger button */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addPassenger}
                    leftIcon={<UserPlus className="w-4 h-4" />}
                    disabled={seatInfo !== null && passengers.length >= seatInfo.availableCount}
                  >
                    {t('sellTicket.addPassenger')}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Shared options */}
            {route && (
              <Card>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket.promoCode')}
                      </label>
                      <input
                        className={inputClass}
                        placeholder={t('sellTicket.promoPlaceholder')}
                        value={discountCode}
                        onChange={e => setDiscountCode(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                        {t('sellTicket.paymentMethod')}
                      </label>
                      <select
                        className={inputClass}
                        value={paymentMethod}
                        onChange={e => setPaymentMethod(e.target.value)}
                      >
                        <option value="">{t('sellTicket.payDefault')}</option>
                        <option value="CASH">{t('sellTicket.payCash')}</option>
                        <option value="MOBILE_MONEY">{t('sellTicket.payMobile')}</option>
                        <option value="CARD">{t('sellTicket.payCard')}</option>
                      </select>
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button
                      onClick={handleCalculatePrice}
                      disabled={!canCalculate || loadingPrice}
                      loading={loadingPrice}
                      leftIcon={<Calculator className="w-4 h-4" />}
                    >
                      {t('sellTicket.calculatePrice')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Right column: pricing summary ── */}
          <div className="lg:col-span-2 space-y-5">
            {!batchResult && !loadingPrice && (
              <Card>
                <CardContent className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">
                  <Ticket className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  {t('sellTicket.fillFormHint')}
                  <br />
                  <span className="font-medium">"{t('sellTicket.calculatePrice')}"</span>
                </CardContent>
              </Card>
            )}

            {loadingPrice && (
              <Card>
                <CardContent className="py-12 flex flex-col items-center gap-3 text-sm text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
                  {t('sellTicket.calculating')}
                </CardContent>
              </Card>
            )}

            {batchResult && (
              <>
                {/* Price card */}
                <Card className="border-green-300 dark:border-green-700">
                  <CardHeader
                    heading={t('sellTicket.priceSummary')}
                    description={
                      batchResult.tickets.length > 1
                        ? t('sellTicket.groupSummaryDesc', { count: String(batchResult.tickets.length) })
                        : undefined
                    }
                  />
                  <CardContent className="space-y-3">
                    {batchResult.pricingSummary.perTicket.map(pt => (
                      <div key={pt.ticketId} className="flex justify-between text-sm">
                        <span className="text-slate-600 dark:text-slate-400">
                          {pt.passengerName}
                          {pt.seatNumber && (
                            <span className="text-xs text-slate-400 ml-1">
                              ({t('sellTicket.seat')} {pt.seatNumber})
                            </span>
                          )}
                          <span className="text-xs text-slate-400 ml-1">
                            [{pt.fareClass}]
                          </span>
                        </span>
                        <span className="text-slate-900 dark:text-slate-100 font-medium">
                          {formatCurrency(pt.total)}
                        </span>
                      </div>
                    ))}

                    <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between items-baseline">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{t('sellTicket.total')}</span>
                      <span className="text-xl font-bold text-slate-900 dark:text-slate-50">
                        {formatCurrency(batchResult.pricingSummary.grandTotal)}
                      </span>
                    </div>
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
                  {t('sellTicket.confirmAndPrint')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
