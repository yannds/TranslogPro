/**
 * StationAgentApp — Application Agent de Gare (tablette)
 *
 * Interface opérateur pour la vente de billets, le check-in passagers,
 * la gestion des colis et la caisse.
 *
 * Structure :
 *   Header    → nom agent + gare + heure
 *   Tabs      → Vente | Check-in | Colis | Caisse
 *
 *   [Vente]
 *     SearchTrip  → formulaire départ/arrivée/date
 *     TripList    → liste compacte des prochains départs
 *     SellForm    → saisie passager + émission billet
 *
 *   [Check-in]
 *     ScanInput  → saisie code billet / scan
 *     PassResult → résultat validation billet
 *
 *   [Colis]
 *     ColisForm  → enregistrement colis : expéditeur, destinataire, poids
 *
 *   [Caisse]
 *     CaisseSummary → résumé ventes de la journée
 */

import { useState, useCallback, useRef, useEffect, type FormEvent } from 'react';
import { cn } from '../../lib/utils';
import { ROLE_PERMISSIONS } from '../../lib/hooks/useNavigation';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { apiGet, apiPost, ApiError } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'vente' | 'checkin' | 'scan-colis' | 'colis' | 'caisse';

/** Permissions pertinentes pour cet écran */
const P_TICKET_CREATE   = 'data.ticket.create.agency';
const P_TICKET_SCAN     = 'data.ticket.scan.agency';
const P_TRAVELER_VERIFY = 'data.traveler.verify.agency';
const P_PARCEL_CREATE   = 'data.parcel.create.agency';
const P_PARCEL_SCAN     = 'data.parcel.scan.agency';
const P_CASHIER_OPEN    = 'data.cashier.open.own';
const P_CASHIER_TX      = 'data.cashier.transaction.own';

// ─── Types API scan (miroirs de scan.service.ts côté backend) ─────────────
type TicketNextAction = 'CHECK_IN' | 'BOARD' | 'ALREADY_CHECKED_IN' | 'ALREADY_BOARDED' | 'TICKET_CANCELLED' | 'TICKET_EXPIRED' | 'TICKET_PENDING';

interface TicketLookupResponse {
  kind:     'TICKET';
  ticket:   { id: string; qrCode: string; passengerName: string; seatNumber: string | null; fareClass: string; status: string };
  trip:     { id: string; status: string; departureScheduled: string | null; routeLabel: string; busPlate: string | null } | null;
  traveler: { id: string; status: string } | null;
  nextAction: TicketNextAction;
}

type ParcelNextAction = 'LOAD' | 'ARRIVE' | 'DELIVER' | 'ALREADY_DELIVERED' | 'CANCELLED' | 'PACK';

interface ParcelLookupResponse {
  kind:   'PARCEL';
  parcel: { id: string; trackingCode: string; weight: number; status: string; destinationCity: string | null };
  trip:   { id: string; status: string; departureScheduled: string | null; routeLabel: string; busPlate: string | null } | null;
  nextAction: ParcelNextAction;
}

interface TabDef {
  id:    Tab;
  label: string;
  icon:  string;
  anyOf: string[];
}

// ─── i18n keys ──────────────────────────────────────────────────────────────

const ALL_TABS: TabDef[] = [
  { id: 'vente',      label: 'Vente',        icon: '🎫', anyOf: [P_TICKET_CREATE] },
  { id: 'checkin',    label: 'Scan billet',  icon: '🎟️', anyOf: [P_TICKET_SCAN, P_TRAVELER_VERIFY] },
  { id: 'scan-colis', label: 'Scan colis',   icon: '📮', anyOf: [P_PARCEL_SCAN] },
  { id: 'colis',      label: 'Enreg. colis', icon: '📦', anyOf: [P_PARCEL_CREATE] },
  { id: 'caisse',     label: 'Caisse',       icon: '💰', anyOf: [P_CASHIER_OPEN, P_CASHIER_TX] },
];

const TAB_LABELS: Record<Tab, string> = {
  vente:        'stationAgent.tabSale',
  checkin:      'stationAgent.tabScanTicket',
  'scan-colis': 'stationAgent.tabScanParcel',
  colis:        'stationAgent.tabParcels',
  caisse:       'stationAgent.tabCashier',
};

function filterTabs(permissions: string[]): TabDef[] {
  const perms = new Set(permissions);
  return ALL_TABS.filter(t => t.anyOf.some(p => perms.has(p)));
}

interface UpcomingTrip {
  id:          string;
  heureDepart: string;
  destination: string;
  quai:        string;
  placesLibres:number;
  prix:        number;
  agence:      string;
}

// ─── Données de démo ─────────────────────────────────────────────────────────

const UPCOMING_TRIPS: UpcomingTrip[] = [
  { id: 't1', heureDepart: '08:15', destination: 'Ziguinchor',  quai: 'A3', placesLibres: 19, prix: 8000,  agence: 'Senbus' },
  { id: 't2', heureDepart: '09:00', destination: 'Tambacounda', quai: 'D2', placesLibres: 32, prix: 5500,  agence: 'Dakar Dem Dikk' },
  { id: 't3', heureDepart: '09:15', destination: 'Diourbel',    quai: 'B3', placesLibres: 8,  prix: 2200,  agence: 'Mouride Express' },
  { id: 't4', heureDepart: '09:30', destination: 'Mbour',       quai: 'C2', placesLibres: 0,  prix: 2500,  agence: 'Ocean Express' },
  { id: 't5', heureDepart: '09:45', destination: 'Touba',       quai: 'A2', placesLibres: 21, prix: 3200,  agence: 'Touba Travel' },
];

// (Ancien MOCK_TICKET retiré — le TabCheckin est désormais branché au vrai
// endpoint GET /tenants/:tid/scan/ticket via scan.controller.ts.)

// ─── Tab: Vente ───────────────────────────────────────────────────────────────

function TabVente() {
  const { t } = useI18n();
  const formatXAF = useCurrencyFormatter();
  const [selectedTrip, setSelectedTrip]   = useState<UpcomingTrip | null>(null);
  const [ticketIssued, setTicketIssued]   = useState(false);
  const [ticketCode]                       = useState(() => `TLP-${Date.now().toString(36).toUpperCase()}`);
  const [passenger, setPassenger]          = useState({ prenom: '', nom: '', telephone: '' });

  if (ticketIssued && selectedTrip) {
    return (
      <div className="p-5 flex flex-col items-center gap-5">
        <div className="w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center text-2xl text-white">✓</div>
        <div className="text-center">
          <p className="text-xl font-bold text-white">{'stationAgent.ticketIssued'}</p>
          <p className="text-slate-400 text-sm mt-1">{'stationAgent.printOrSms'}</p>
        </div>
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-5 w-full max-w-sm">
          <p className="text-xs text-slate-400 uppercase tracking-widest mb-1 text-center">{'stationAgent.ticketCode'}</p>
          <p className="text-3xl font-mono font-black text-teal-300 text-center tracking-widest">{ticketCode}</p>
          <div className="mt-4 space-y-2 text-sm">
            <InfoRow label={'stationAgent.passenger'} value={`${passenger.prenom} ${passenger.nom}`} />
            <InfoRow label={'stationAgent.trip'} value={`Dakar → ${selectedTrip.destination}`} />
            <InfoRow label={'stationAgent.departure'} value={selectedTrip.heureDepart} />
            <InfoRow label={'stationAgent.platform'} value={selectedTrip.quai} />
            <InfoRow label={'stationAgent.price'} value={formatXAF(selectedTrip.prix)} />
          </div>
        </div>
        <div className="flex gap-3 w-full max-w-sm">
          <button className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl font-semibold text-sm hover:bg-teal-700">
            {'stationAgent.print'}
          </button>
          <button
            onClick={() => { setSelectedTrip(null); setTicketIssued(false); }}
            className="flex-1 py-2.5 bg-slate-700 text-white rounded-xl font-semibold text-sm hover:bg-slate-600"
          >
            {'stationAgent.newTicket'}
          </button>
        </div>
      </div>
    );
  }

  if (selectedTrip) {
    return (
      <div className="p-5">
        {/* Trip recap */}
        <div className="bg-teal-900/40 border border-teal-700 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-white">Dakar → {selectedTrip.destination}</p>
              <p className="text-sm text-teal-300">{selectedTrip.heureDepart} · {'stationAgent.platform'} {selectedTrip.quai} · {selectedTrip.agence}</p>
            </div>
            <p className="text-xl font-bold text-teal-300">{formatXAF(selectedTrip.prix)}</p>
          </div>
        </div>

        {/* Passenger form */}
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.firstName'}</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={passenger.prenom}
                onChange={e => setPassenger(p => ({ ...p, prenom: e.target.value }))}
                placeholder="Moussa"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.lastName'}</label>
              <input
                className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                value={passenger.nom}
                onChange={e => setPassenger(p => ({ ...p, nom: e.target.value }))}
                placeholder="Diallo"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.phoneLabel'}</label>
            <input
              className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              value={passenger.telephone}
              onChange={e => setPassenger(p => ({ ...p, telephone: e.target.value }))}
              placeholder="+221 77 000 00 00"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setSelectedTrip(null)}
            className="flex-1 py-3 bg-slate-700 text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-600"
          >
            {'stationAgent.back'}
          </button>
          <button
            onClick={() => setTicketIssued(true)}
            disabled={!passenger.prenom || !passenger.nom || !passenger.telephone}
            className="flex-1 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-700 disabled:opacity-40"
          >
            {'stationAgent.issueTicket'} · {formatXAF(selectedTrip.prix)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{'stationAgent.upcomingDepartures'}</p>
      {UPCOMING_TRIPS.map(trip => (
        <button
          key={trip.id}
          disabled={trip.placesLibres === 0}
          onClick={() => setSelectedTrip(trip)}
          className={cn(
            'w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all',
            trip.placesLibres === 0
              ? 'border-slate-800 bg-slate-900/50 opacity-50 cursor-not-allowed'
              : 'border-slate-700 bg-slate-900 hover:border-teal-600 hover:bg-slate-800',
          )}
        >
          <div className="flex items-center gap-4">
            <div className="text-center min-w-[3rem]">
              <p className="text-xl font-black text-white tabular-nums">{trip.heureDepart}</p>
            </div>
            <div>
              <p className="font-semibold text-white">{trip.destination}</p>
              <p className="text-xs text-slate-400 mt-0.5">{'stationAgent.platform'} {trip.quai} · {trip.agence}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-teal-300">{formatXAF(trip.prix)}</p>
            {trip.placesLibres === 0 ? (
              <p className="text-xs text-red-400 mt-0.5">{'stationAgent.full'}</p>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">{trip.placesLibres} {'stationAgent.seats'}</p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Tab: Check-in ────────────────────────────────────────────────────────────

// Meta visuelle pour chaque `nextAction` retourné par le backend /scan/ticket.
// Séparé du rendu pour que l'i18n et la couleur restent centralisés.
const TICKET_ACTION_META: Record<TicketNextAction, { cls: string; icon: string; labelKey: string; cta?: 'CHECK_IN' | 'BOARD' }> = {
  CHECK_IN:           { cls: 'bg-emerald-900/60 border-emerald-700 text-emerald-300', icon: '✓', labelKey: 'stationAgent.statusCheckInReady', cta: 'CHECK_IN' },
  BOARD:              { cls: 'bg-teal-900/60 border-teal-700 text-teal-300',          icon: '→', labelKey: 'stationAgent.statusReadyToBoard', cta: 'BOARD' },
  ALREADY_CHECKED_IN: { cls: 'bg-blue-900/60 border-blue-700 text-blue-300',          icon: '✓', labelKey: 'stationAgent.statusAlreadyCheckedIn' },
  ALREADY_BOARDED:    { cls: 'bg-orange-900/60 border-orange-700 text-orange-300',    icon: '⚠', labelKey: 'stationAgent.statusAlreadyBoarded' },
  TICKET_CANCELLED:   { cls: 'bg-red-900/60 border-red-700 text-red-300',             icon: '✕', labelKey: 'stationAgent.statusCancelled' },
  TICKET_EXPIRED:     { cls: 'bg-red-900/60 border-red-700 text-red-300',             icon: '⏱', labelKey: 'stationAgent.statusExpired' },
  TICKET_PENDING:     { cls: 'bg-amber-900/60 border-amber-700 text-amber-300',       icon: '⏸', labelKey: 'stationAgent.statusPending' },
};

// Toast léger auto-dismiss — suffisant pour le portail quai. Pas de portail
// global : simple banner en haut de la tab.
interface ToastState { kind: 'ok' | 'error' | 'info'; message: string }

function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((t: ToastState, ms = 3500) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(t);
    timerRef.current = setTimeout(() => setToast(null), ms);
  }, []);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return { toast, show };
}

function ToastBanner({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  const cls = toast.kind === 'ok'
    ? 'bg-emerald-600 border-emerald-400 text-white'
    : toast.kind === 'error'
      ? 'bg-red-600 border-red-400 text-white'
      : 'bg-slate-700 border-slate-500 text-white';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-xl border-2 px-4 py-3 font-bold text-sm shadow-lg',
        'animate-pulse-once',
        cls,
      )}
    >
      {toast.message}
    </div>
  );
}

function TabCheckin() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [code, setCode]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [lookup, setLookup]   = useState<TicketLookupResponse | null>(null);
  const { toast, show }       = useToast();
  const inputRef              = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setLookup(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const handleScan = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !tenantId) return;
    setBusy(true);
    try {
      const res = await apiGet<TicketLookupResponse>(
        `/api/tenants/${tenantId}/scan/ticket?code=${encodeURIComponent(code.trim())}&intent=check-in`,
      );
      setLookup(res);
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      show({ kind: 'error', message: msg || t('stationAgent.ticketNotFound') });
      setLookup(null);
    } finally {
      setBusy(false);
    }
  }, [code, tenantId, show, t]);

  const runAction = useCallback(async (kind: 'CHECK_IN' | 'BOARD') => {
    if (!lookup || !lookup.trip) return;
    const { ticket, trip } = lookup;
    setBusy(true);
    try {
      const url = kind === 'CHECK_IN'
        ? `/api/tenants/${tenantId}/flight-deck/trips/${trip.id}/passengers/${ticket.id}/check-in`
        : `/api/tenants/${tenantId}/flight-deck/trips/${trip.id}/passengers/${ticket.id}/board`;
      if (kind === 'CHECK_IN') {
        await apiPost(url, {});
      } else {
        // Le board endpoint est en PATCH côté backend.
        await (await import('../../lib/api')).apiPatch(url, {});
      }
      show({
        kind: 'ok',
        message: kind === 'CHECK_IN'
          ? t('stationAgent.toastCheckInOk')
          : t('stationAgent.toastBoardOk'),
      });
      reset();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      show({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  }, [lookup, tenantId, reset, show, t]);

  const meta = lookup ? TICKET_ACTION_META[lookup.nextAction] : null;

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        {t('stationAgent.scanTicket')}
      </p>

      <ToastBanner toast={toast} />

      <form onSubmit={handleScan} className="flex gap-3">
        <input
          ref={inputRef}
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder={t('stationAgent.scanTicketPlaceholder')}
          disabled={busy}
          className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-slate-500 disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="px-5 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 disabled:opacity-40"
        >
          {busy ? '…' : t('stationAgent.verify')}
        </button>
      </form>

      {lookup && meta && (
        <div className={cn('rounded-2xl border p-5', meta.cls)}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl" aria-hidden>{meta.icon}</span>
            <p className="text-lg font-black uppercase">{t(meta.labelKey)}</p>
          </div>
          <div className="space-y-2 text-sm">
            <InfoRow label={'stationAgent.passenger'} value={lookup.ticket.passengerName} />
            {lookup.trip && <InfoRow label={'stationAgent.trip'} value={lookup.trip.routeLabel} />}
            {lookup.ticket.seatNumber && <InfoRow label={'stationAgent.seat'} value={lookup.ticket.seatNumber} />}
            <InfoRow label={'stationAgent.code'} value={lookup.ticket.id.slice(0, 12) + '…'} />
            {lookup.traveler && (
              <InfoRow label={'stationAgent.currentState'} value={lookup.traveler.status} />
            )}
          </div>

          {meta.cta && (
            <button
              onClick={() => runAction(meta.cta!)}
              disabled={busy}
              className={cn(
                'mt-4 w-full py-2.5 rounded-xl font-bold text-sm text-white transition-colors disabled:opacity-40',
                meta.cta === 'CHECK_IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-teal-600 hover:bg-teal-700',
              )}
            >
              {busy ? '…' : t(meta.cta === 'CHECK_IN' ? 'stationAgent.confirmCheckIn' : 'stationAgent.confirmBoarding')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Scan Colis ──────────────────────────────────────────────────────────

const PARCEL_ACTION_META: Record<ParcelNextAction, { cls: string; icon: string; labelKey: string; ctaKey?: string; action?: string }> = {
  PACK:              { cls: 'bg-slate-800 border-slate-700 text-slate-300',         icon: '?', labelKey: 'stationAgent.statusParcelPack' },
  LOAD:              { cls: 'bg-emerald-900/60 border-emerald-700 text-emerald-300', icon: '✓', labelKey: 'stationAgent.statusParcelReadyLoad', ctaKey: 'stationAgent.confirmLoad', action: 'LOAD' },
  ARRIVE:            { cls: 'bg-teal-900/60 border-teal-700 text-teal-300',          icon: '→', labelKey: 'stationAgent.statusParcelInTransit', ctaKey: 'stationAgent.confirmArrive', action: 'ARRIVE' },
  DELIVER:           { cls: 'bg-indigo-900/60 border-indigo-700 text-indigo-300',    icon: '📬', labelKey: 'stationAgent.statusParcelArrived', ctaKey: 'stationAgent.confirmDeliver', action: 'DELIVER' },
  ALREADY_DELIVERED: { cls: 'bg-orange-900/60 border-orange-700 text-orange-300',    icon: '✓✓', labelKey: 'stationAgent.statusParcelDelivered' },
  CANCELLED:         { cls: 'bg-red-900/60 border-red-700 text-red-300',             icon: '✕', labelKey: 'stationAgent.statusParcelCancelled' },
};

function TabScanColis() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [code, setCode]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [lookup, setLookup] = useState<ParcelLookupResponse | null>(null);
  const { toast, show }     = useToast();
  const inputRef            = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setLookup(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const handleScan = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim() || !tenantId) return;
    setBusy(true);
    try {
      const res = await apiGet<ParcelLookupResponse>(
        `/api/tenants/${tenantId}/scan/parcel?code=${encodeURIComponent(code.trim())}`,
      );
      setLookup(res);
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      show({ kind: 'error', message: msg || t('stationAgent.parcelNotFound') });
      setLookup(null);
    } finally {
      setBusy(false);
    }
  }, [code, tenantId, show, t]);

  const runAction = useCallback(async (action: string) => {
    if (!lookup) return;
    const { parcel } = lookup;
    setBusy(true);
    try {
      // Le endpoint parcel.scan attend action + stationId. Pour LOAD/ARRIVE/DELIVER
      // le stationId n'est pas toujours strictement requis selon le blueprint tenant —
      // on envoie une chaîne vide pour que le backend applique ses guards.
      await apiPost(`/api/tenants/${tenantId}/parcels/${parcel.id}/scan`, {
        action,
        stationId: '',
      });
      show({ kind: 'ok', message: t('stationAgent.toastParcelOk') });
      reset();
    } catch (e) {
      const msg = e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e);
      show({ kind: 'error', message: msg });
    } finally {
      setBusy(false);
    }
  }, [lookup, tenantId, reset, show, t]);

  const meta = lookup ? PARCEL_ACTION_META[lookup.nextAction] : null;

  return (
    <div className="p-5 space-y-4">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        {t('stationAgent.scanParcel')}
      </p>

      <ToastBanner toast={toast} />

      <form onSubmit={handleScan} className="flex gap-3">
        <input
          ref={inputRef}
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder={t('stationAgent.scanParcelPlaceholder')}
          disabled={busy}
          className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder:text-slate-500 disabled:opacity-50"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="px-5 py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-40"
        >
          {busy ? '…' : t('stationAgent.verify')}
        </button>
      </form>

      {lookup && meta && (
        <div className={cn('rounded-2xl border p-5', meta.cls)}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl" aria-hidden>{meta.icon}</span>
            <p className="text-lg font-black uppercase">{t(meta.labelKey)}</p>
          </div>
          <div className="space-y-2 text-sm">
            <InfoRow label={'stationAgent.trackingCode'} value={lookup.parcel.trackingCode} />
            {lookup.parcel.destinationCity && <InfoRow label={'stationAgent.destination'} value={lookup.parcel.destinationCity} />}
            <InfoRow label={'stationAgent.weightKg'} value={`${lookup.parcel.weight} kg`} />
            <InfoRow label={'stationAgent.currentState'} value={lookup.parcel.status} />
            {lookup.trip && <InfoRow label={'stationAgent.trip'} value={lookup.trip.routeLabel} />}
          </div>

          {meta.ctaKey && meta.action && (
            <button
              onClick={() => runAction(meta.action!)}
              disabled={busy}
              className="mt-4 w-full py-2.5 bg-purple-600 text-white rounded-xl font-bold text-sm hover:bg-purple-700 disabled:opacity-40"
            >
              {busy ? '…' : t(meta.ctaKey)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Colis ───────────────────────────────────────────────────────────────

function TabColis() {
  const { t } = useI18n();
  const [form, setForm] = useState({
    expediteur: '', destinataire: '', telephone: '', destination: 'Ziguinchor', description: '', poids: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [trackCode] = useState(() => `COL-${Date.now().toString(36).toUpperCase()}`);

  if (submitted) {
    return (
      <div className="p-5 flex flex-col items-center gap-4">
        <div className="w-14 h-14 bg-purple-500 rounded-full flex items-center justify-center text-2xl text-white">📦</div>
        <p className="text-xl font-bold text-white">{'stationAgent.parcelRegistered'}</p>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-full max-w-sm">
          <p className="text-xs text-slate-400 uppercase tracking-widest text-center mb-1">{'stationAgent.trackingCode'}</p>
          <p className="text-3xl font-mono font-black text-purple-300 text-center tracking-widest">{trackCode}</p>
          <div className="mt-4 space-y-2 text-sm">
            <InfoRow label={'stationAgent.sender'}      value={form.expediteur} />
            <InfoRow label={'stationAgent.recipient'}   value={form.destinataire} />
            <InfoRow label={'stationAgent.destination'} value={form.destination} />
            <InfoRow label={'stationAgent.descriptionLabel'} value={form.description} />
            <InfoRow label={'stationAgent.weightKg'}    value={`${form.poids} kg`} />
          </div>
        </div>
        <button
          onClick={() => { setSubmitted(false); setForm({ expediteur: '', destinataire: '', telephone: '', destination: 'Ziguinchor', description: '', poids: '' }); }}
          className="py-2.5 px-8 bg-slate-700 text-white rounded-xl font-semibold text-sm hover:bg-slate-600"
        >
          {'stationAgent.newParcel'}
        </button>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-3">
      <p className="text-sm font-semibold text-slate-300 uppercase tracking-wider">{'stationAgent.parcelRegistration'}</p>
      {[
        { label: 'stationAgent.sender', key: 'expediteur', placeholder: 'stationAgent.senderPlaceholder' },
        { label: 'stationAgent.recipient', key: 'destinataire', placeholder: 'stationAgent.recipientPlaceholder' },
        { label: 'stationAgent.recipientPhone', key: 'telephone', placeholder: '+221 77 000 00 00' },
      ].map(({ label, key, placeholder }) => (
        <div key={key}>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{label}</label>
          <input
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder={placeholder}
            value={(form as any)[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.destination'}</label>
          <select
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            value={form.destination}
            onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
          >
            {['Ziguinchor', 'Tambacounda', 'Kaolack', 'Saint-Louis', 'Thiès', 'Diourbel', 'Touba'].map(v => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.weightKg'}</label>
          <input
            type="number"
            className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            placeholder="5"
            value={form.poids}
            onChange={e => setForm(f => ({ ...f, poids: e.target.value }))}
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">{'stationAgent.descriptionLabel'}</label>
        <input
          className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Vêtements, alimentation, fragile..."
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>
      <button
        onClick={() => setSubmitted(true)}
        disabled={!form.expediteur || !form.destinataire || !form.poids}
        className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-40 mt-2"
      >
        {'stationAgent.registerParcel'}
      </button>
    </div>
  );
}

// ─── Tab: Caisse ──────────────────────────────────────────────────────────────

function TabCaisse() {
  const { t } = useI18n();
  const formatXAF = useCurrencyFormatter();
  const sales = [
    { heure: '07:15', passager: 'Moussa Diallo',   destination: 'Ziguinchor',  prix: 8000,  mode: 'Cash' },
    { heure: '07:28', passager: 'Fatou Ba',         destination: 'Kaolack',     prix: 2800,  mode: 'Wave' },
    { heure: '07:44', passager: 'Ibrahima Seck',    destination: 'Saint-Louis', prix: 3500,  mode: 'Orange Money' },
    { heure: '08:00', passager: 'Aissatou Diallo',  destination: 'Tambacounda', prix: 5500,  mode: 'Cash' },
    { heure: '08:11', passager: 'Cheikh Touré',     destination: 'Diourbel',    prix: 2200,  mode: 'Wave' },
  ];
  const total = sales.reduce((s, r) => s + r.prix, 0);
  const byMode: Record<string, number> = {};
  sales.forEach(s => { byMode[s.mode] = (byMode[s.mode] ?? 0) + s.prix; });

  return (
    <div className="p-5 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-teal-900/40 border border-teal-700 rounded-xl p-4 text-center">
          <p className="text-xs text-teal-400 uppercase tracking-wider font-semibold">{'stationAgent.dayTotal'}</p>
          <p className="text-2xl font-black text-white mt-1">{formatXAF(total)}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{'stationAgent.ticketsSold'}</p>
          <p className="text-2xl font-black text-white mt-1">{sales.length}</p>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{'stationAgent.parcels'}</p>
          <p className="text-2xl font-black text-white mt-1">3</p>
        </div>
      </div>

      {/* By mode */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{'stationAgent.byPaymentMode'}</p>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(byMode).map(([mode, amt]) => (
            <span key={mode} className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm">
              <span className="text-slate-400">{mode}:</span>{' '}
              <span className="text-white font-semibold">{formatXAF(amt)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Transaction list */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{'stationAgent.recentTransactions'}</p>
        <div className="space-y-2">
          {sales.map((s, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-sm font-mono text-slate-500 tabular-nums">{s.heure}</span>
                <div>
                  <p className="text-sm font-medium text-white">{s.passager}</p>
                  <p className="text-xs text-slate-500">{s.destination} · {s.mode}</p>
                </div>
              </div>
              <span className="text-sm font-bold text-teal-300">{formatXAF(s.prix)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

type DemoRoleKey = keyof typeof ROLE_PERMISSIONS;

const DEMO_ROLES: DemoRoleKey[] = ['STATION_AGENT', 'SUPERVISOR', 'CASHIER', 'AGENCY_MANAGER'];

export function StationAgentApp() {
  const { t } = useI18n();
  const [roleIdx, setRoleIdx]   = useState(0);
  const roleKey                  = DEMO_ROLES[roleIdx] as DemoRoleKey;
  const permissions              = ROLE_PERMISSIONS[roleKey] ?? [];
  const TABS                     = filterTabs(permissions);
  const [tab, setTab]            = useState<Tab>(() => filterTabs(permissions)[0]?.id ?? 'vente');

  // Reset tab when role changes and tab is no longer visible
  const visibleIds = TABS.map(t => t.id);
  const effectiveTab: Tab = visibleIds.includes(tab) ? tab : (visibleIds[0] ?? 'vente');

  return (
    <div
      className="flex flex-col h-screen bg-slate-950 text-white overflow-hidden"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-teal-600 rounded-full flex items-center justify-center font-bold text-sm">NA</div>
          <div>
            <p className="text-sm font-bold text-white">Nadège Nkounkou</p>
            <p className="text-xs text-slate-400">Gare Routière de Pointe-Noire</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Role switcher démo */}
          <select
            value={roleIdx}
            onChange={e => { const idx = Number(e.target.value); setRoleIdx(idx); const tabs = filterTabs(ROLE_PERMISSIONS[DEMO_ROLES[idx]!] ?? []); setTab(tabs[0]?.id ?? 'vente'); }}
            className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
          >
            {DEMO_ROLES.map((r, i) => <option key={r} value={i}>{r}</option>)}
          </select>
          <span className="text-xs bg-emerald-900/60 text-emerald-300 border border-emerald-700 px-2 py-1 rounded-lg font-semibold">
            {'stationAgent.onDuty'}
          </span>
          <span className="text-sm font-mono text-slate-400">
            {new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      {/* Tabs — filtrés par permissions */}
      <div className="flex border-b border-slate-800 shrink-0 bg-slate-900">
        {TABS.map(td => (
          <button
            key={td.id}
            onClick={() => setTab(td.id)}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 py-3 text-xs font-semibold uppercase tracking-wide transition-colors',
              effectiveTab === td.id
                ? 'text-teal-400 border-b-2 border-teal-500 bg-slate-800'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50',
            )}
          >
            <span className="text-base">{td.icon}</span>
            {t(TAB_LABELS[td.id])}
          </button>
        ))}
        {TABS.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-3 text-xs text-slate-600">
            {'stationAgent.noPermission'}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === 'vente'      && <TabVente />}
        {effectiveTab === 'checkin'    && <TabCheckin />}
        {effectiveTab === 'scan-colis' && <TabScanColis />}
        {effectiveTab === 'colis'      && <TabColis />}
        {effectiveTab === 'caisse'     && <TabCaisse />}
      </div>
    </div>
  );
}

export default StationAgentApp;
