/**
 * PortailVoyageur v2 — Portail public de réservation (white-label luxe)
 *
 * Améliorations v2 :
 *   - Language switcher 8 locales
 *   - Hero carousel avec images fond configurable
 *   - Logo tenant (pas TranslogPro)
 *   - Recherche par VILLE (pas par gare)
 *   - Section "Gares proches" (GPS + recherche ville)
 *   - Section colis (suivi + envoi)
 *   - Modal booking responsive (pas juste mobile drawer)
 *   - i18n dès le départ
 */

import { useState, useEffect, useRef, useMemo, type FormEvent, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { apiFetch } from '../../lib/api';
import { useFetch } from '../../lib/hooks/useFetch';
import { ComboboxEditable, type ComboboxOption } from '../ui/ComboboxEditable';
import { TripDatePicker } from './TripDatePicker';
import type { Language } from '../../lib/i18n/types';
import { createContext, useContext } from 'react';
import { getTheme, type PortalTheme } from './portal-themes';
import {
  HorizonNavbar, HorizonHero, HorizonTripCard, HorizonSectionTitle, HorizonFooter,
  VividNavbar, VividHero, VividTripCard, VividSectionTitle, VividFooter,
  PrestigeNavbar, PrestigeHero, PrestigeTripCard, PrestigeSectionTitle, PrestigeFooter,
  type NavItem as LayoutNavItem, type VariantTripCardProps,
} from './layout-variants';

// Theme context — all sub-components read the active theme from here
const PortalThemeCtx = createContext<PortalTheme>(getTheme());
function usePortalTheme() { return useContext(PortalThemeCtx); }
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon in bundlers
const defaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentMethod {
  providerId: string;
  displayName: string;
  type: 'MOBILE_MONEY' | 'CARD';
  logoUrl?: string;
  phonePrefix?: string;
}

interface TripResult {
  id: string;
  departure: string;
  arrival: string;
  departureTime: string;
  arrivalTime: string;
  price: number;
  distanceKm?: number;
  availableSeats: number;
  busType: string;
  busModel: string;
  amenities: string[];
  canBook: boolean;
  stops?: { city: string; name: string; km: number }[];
}

interface StationInfo {
  name: string;
  city: string;
  type: string;
  coordinates?: { lat: number; lng: number };
}

interface PassengerInfo {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  seatType: 'STANDARD' | 'VIP';
}

// ─── Demo data (fallback) ───────────────────────────────────────────────────

const DEMO_STATIONS: StationInfo[] = [
  { name: 'Gare Centrale', city: 'Brazzaville', type: 'PRINCIPALE', coordinates: { lat: -4.2634, lng: 15.2429 } },
  { name: 'Gare Routière Nord', city: 'Brazzaville', type: 'RELAIS', coordinates: { lat: -4.2500, lng: 15.2600 } },
  { name: 'Gare Océan', city: 'Pointe-Noire', type: 'PRINCIPALE', coordinates: { lat: -4.7692, lng: 11.8664 } },
  { name: 'Gare Loandjili', city: 'Pointe-Noire', type: 'RELAIS', coordinates: { lat: -4.7800, lng: 11.8500 } },
  { name: 'Gare de Dolisie', city: 'Dolisie', type: 'PRINCIPALE', coordinates: { lat: -4.1956, lng: 12.6666 } },
  { name: 'Gare de Nkayi', city: 'Nkayi', type: 'RELAIS', coordinates: { lat: -4.1700, lng: 13.2830 } },
  { name: 'Gare de Ouesso', city: 'Ouesso', type: 'RELAIS', coordinates: { lat: 1.6136, lng: 16.0517 } },
  { name: 'Gare de Owando', city: 'Owando', type: 'RELAIS', coordinates: { lat: -0.4833, lng: 15.9000 } },
];

const DEMO_TRIPS: TripResult[] = [
  { id: 't1', departure: 'Brazzaville', arrival: 'Pointe-Noire', departureTime: '2026-04-17T06:00:00', arrivalTime: '2026-04-17T14:00:00', price: 15000, availableSeats: 18, busType: 'VIP', busModel: 'Mercedes Tourismo', amenities: ['Climatisation', 'WiFi', 'Prises USB', 'Toilettes'], canBook: true },
  { id: 't2', departure: 'Brazzaville', arrival: 'Pointe-Noire', departureTime: '2026-04-17T08:30:00', arrivalTime: '2026-04-17T16:30:00', price: 12000, availableSeats: 5, busType: 'CONFORT', busModel: 'Yutong ZK6122', amenities: ['Climatisation', 'Prises USB'], canBook: true },
  { id: 't3', departure: 'Brazzaville', arrival: 'Pointe-Noire', departureTime: '2026-04-17T11:00:00', arrivalTime: '2026-04-17T19:00:00', price: 10000, availableSeats: 32, busType: 'STANDARD', busModel: 'King Long XMQ6127', amenities: ['Climatisation'], canBook: true },
  { id: 't4', departure: 'Brazzaville', arrival: 'Pointe-Noire', departureTime: '2026-04-17T14:00:00', arrivalTime: '2026-04-17T22:00:00', price: 15000, availableSeats: 0, busType: 'VIP', busModel: 'Mercedes Tourismo', amenities: ['Climatisation', 'WiFi', 'Prises USB', 'Toilettes'], canBook: false },
  { id: 't5', departure: 'Brazzaville', arrival: 'Pointe-Noire', departureTime: '2026-04-17T18:00:00', arrivalTime: '2026-04-18T02:00:00', price: 18000, availableSeats: 8, busType: 'VIP', busModel: 'Scania Touring', amenities: ['Climatisation', 'WiFi', 'Prises USB', 'Toilettes', 'Couchettes'], canBook: true },
];

const DEMO_PAYMENT_METHODS: PaymentMethod[] = [
  { providerId: 'mtn_momo', displayName: 'MTN Mobile Money', type: 'MOBILE_MONEY', phonePrefix: '+242' },
  { providerId: 'airtel_money', displayName: 'Airtel Money', type: 'MOBILE_MONEY', phonePrefix: '+242' },
  { providerId: 'card_visa', displayName: 'Visa', type: 'CARD' },
  { providerId: 'card_mastercard', displayName: 'Mastercard', type: 'CARD' },
];

const POPULAR_ROUTES = [
  { from: 'Brazzaville', to: 'Pointe-Noire', price: 10000, duration: '8h' },
  { from: 'Brazzaville', to: 'Dolisie', price: 8000, duration: '6h' },
  { from: 'Pointe-Noire', to: 'Dolisie', price: 5000, duration: '3h' },
  { from: 'Brazzaville', to: 'Ouesso', price: 25000, duration: '14h' },
];

// Hero scenes — cinematic CSS "photos" evoking luxury bus travel
// Each has a warm golden-hour palette with depth
const HERO_SCENES = [
  // Scene 1: Golden sunrise on open road
  { bg: 'linear-gradient(160deg, #1a0a00 0%, #3d1a00 20%, #b45309 45%, #f59e0b 65%, #fbbf24 80%, #fef3c7 100%)', overlay: 'radial-gradient(ellipse 120% 60% at 50% 80%, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)' },
  // Scene 2: Dusk highway — deep blue to amber horizon
  { bg: 'linear-gradient(175deg, #0c1445 0%, #1e3a5f 30%, #b45309 60%, #d97706 75%, #1e293b 100%)', overlay: 'radial-gradient(ellipse 100% 50% at 50% 90%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)' },
  // Scene 3: Savanna road — warm earth tones, backlit
  { bg: 'linear-gradient(165deg, #0f0a05 0%, #44200d 25%, #92400e 50%, #d97706 70%, #fbbf24 90%, #fffbeb 100%)', overlay: 'radial-gradient(ellipse 110% 55% at 45% 85%, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.25) 55%, transparent 100%)' },
  // Scene 4: Night premium — luxury dark cabin feel
  { bg: 'linear-gradient(150deg, #0a0a0a 0%, #1c1917 25%, #292524 40%, #44403c 55%, #78716c 75%, #d6d3d1 100%)', overlay: 'radial-gradient(ellipse 90% 60% at 50% 75%, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)' },
];

const PAYMENT_COLORS: Record<string, string> = {
  mtn_momo: 'bg-yellow-500', airtel_money: 'bg-red-500', orange_money: 'bg-orange-500',
  wave: 'bg-blue-500', free_money: 'bg-green-500', mpesa: 'bg-green-600',
  moov_money: 'bg-blue-600', card_visa: 'bg-indigo-600', card_mastercard: 'bg-orange-600',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(dep: string, arr: string): string {
  const ms = new Date(arr).getTime() - new Date(dep).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}
function fmtDate(iso: string, locale = 'fr-FR'): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Language Switcher
// ═══════════════════════════════════════════════════════════════════════════════

function LanguageSwitcher() {
  const ctx = useI18n();
  const [open, setOpen] = useState(false);
  const allLangs = Object.entries(ctx.languages) as [Language, (typeof ctx.languages)[Language]][];
  const current = ctx.languages[ctx.lang];

  function pick(code: Language) {
    ctx.setLang(code);
    setOpen(false);
  }

  return (
    <div
      className="relative"
      tabIndex={0}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline text-xs">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6"/></svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 py-1 min-w-[170px] z-[60]">
          {allLangs.map(([code, meta]) => (
            <button
              key={code}
              type="button"
              tabIndex={0}
              onClick={() => pick(code)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left',
                code === ctx.lang
                  ? '[background:color-mix(in_srgb,var(--portal-accent-light),white_50%)] text-amber-700 dark:text-amber-400 font-semibold'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <span className="text-base leading-none">{meta.flag}</span>
              <span>{meta.label}</span>
              {code === ctx.lang && <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hero Carousel
// ═══════════════════════════════════════════════════════════════════════════════

function HeroCarousel({ children }: { children: React.ReactNode }) {
  const th = usePortalTheme();
  const scenes = th.heroScenes;
  const [idx, setIdx] = useState(0);
  useEffect(() => { const t = setInterval(() => setIdx(i => (i + 1) % scenes.length), 7000); return () => clearInterval(t); }, [scenes.length]);
  return (
    <div className="relative overflow-hidden">
      {/* Scenic background layers with crossfade */}
      {scenes.map((scene, i) => (
        <div key={i} className="absolute inset-0 transition-opacity duration-[2500ms] ease-in-out" style={{ opacity: i === idx ? 1 : 0 }}>
          <div className="absolute inset-0" style={{ background: scene.bg }} />
          <div className="absolute inset-0" style={{ background: scene.overlay }} />
          {/* Scenic SVG elements — road lines, sun glow */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice">
            {/* Horizon line */}
            <line x1="0" y1="420" x2="1200" y2="420" stroke="rgba(251,191,36,0.15)" strokeWidth="1" />
            {/* Road perspective lines */}
            <path d="M500,600 L580,420" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
            <path d="M700,600 L620,420" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
            {/* Center dashes */}
            <path d="M598,600 L599,500" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" strokeDasharray="8 12" />
            {/* Sun/glow circle */}
            <circle cx="600" cy="380" r="40" fill="rgba(251,191,36,0.12)" />
            <circle cx="600" cy="380" r="80" fill="rgba(251,191,36,0.04)" />
            {/* Distant bus silhouette */}
            <rect x="575" y="405" width="50" height="18" rx="4" fill="rgba(255,255,255,0.06)" />
            <rect x="580" y="399" width="40" height="8" rx="2" fill="rgba(255,255,255,0.04)" />
            {/* Speed lines */}
            <line x1="200" y1="450" x2="350" y2="450" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <line x1="850" y1="460" x2="1000" y2="460" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <line x1="100" y1="470" x2="280" y2="470" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
          </svg>
        </div>
      ))}
      {/* Dot pattern subtle overlay */}
      <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }} />
      {/* Content */}
      <div className="relative">{children}</div>
      {/* Carousel dots */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2.5">
        {scenes.map((_, i) => (
          <button key={i} onClick={() => setIdx(i)} className={cn('h-1.5 rounded-full transition-all duration-700', i === idx ? 'bg-amber-400 w-8' : 'bg-white/25 hover:bg-white/40 w-1.5')} />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Trip Card (responsive)
// ═══════════════════════════════════════════════════════════════════════════════

function TripCard({ trip, onBook, fmt, t }: { trip: TripResult; onBook: (t: TripResult) => void; fmt: (n: number) => string; t: (k: string) => string }) {
  const th = usePortalTheme();
  const full = trip.availableSeats === 0, urgent = trip.availableSeats > 0 && trip.availableSeats <= 5, isVip = trip.busType === 'VIP';
  return (
    <div className={cn('group relative rounded-2xl border transition-all duration-300 bg-white dark:bg-slate-900/80 backdrop-blur-sm',
      full ? 'border-slate-200 dark:border-slate-800 opacity-60' : 'border-slate-200/80 dark:border-slate-700/50 hover:[border-color:var(--portal-accent)]/60 hover:shadow-xl hover:shadow-amber-500/5')}>
      {isVip && <div className="absolute -top-2.5 left-5 px-3 py-0.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-amber-500/20">VIP</div>}
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
          <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{trip.busModel}</p><p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">{trip.busType}</p></div>
          <div className="flex gap-1.5 flex-wrap">{trip.amenities.map(a => <span key={a} className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">{a}</span>)}</div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <div className="text-center min-w-[60px] sm:min-w-[72px]"><p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.departureTime)}</p><p className="text-xs text-slate-500 mt-0.5">{trip.departure}</p></div>
          <div className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{fmtDuration(trip.departureTime, trip.arrivalTime)}</span>
            <div className="relative w-full h-[2px]"><div className="absolute inset-0 bg-gradient-to-r from-amber-400/40 via-amber-400 to-amber-400/40 rounded-full" /><div className="absolute left-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-amber-500/20" /><div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-amber-500/20" /></div>
            {trip.stops && trip.stops.length > 0 ? (
              <span className="text-[10px] [color:var(--portal-accent)] font-medium">{trip.stops.length} {t('portail.stops')}</span>
            ) : (
              <span className="text-[10px] text-slate-400">{t('portail.direct')}</span>
            )}
          </div>
          <div className="text-center min-w-[60px] sm:min-w-[72px]"><p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{fmtTime(trip.arrivalTime)}</p><p className="text-xs text-slate-500 mt-0.5">{trip.arrival}</p></div>
        </div>
        {/* Stops/escales */}
        {trip.stops && trip.stops.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4 px-1">
            <span className="text-[10px] text-slate-400 font-medium">{t('portail.via')}:</span>
            {trip.stops.map((s, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full [background:color-mix(in_srgb,var(--portal-accent-light),white_50%)] text-amber-700 dark:text-amber-400 font-medium border border-amber-200/50 dark:border-amber-800/30">{s.city}</span>
            ))}
            {trip.distanceKm && <span className="text-[10px] text-slate-400 ml-auto">{trip.distanceKm} km</span>}
          </div>
        )}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/80">
          <div><p className={cn('text-xl sm:text-2xl font-bold', isVip ? '[color:var(--portal-accent)]' : 'text-slate-900 dark:text-white')}>{fmt(trip.price)}</p><p className="text-[11px] text-slate-400 mt-0.5">{t('portail.perPassenger')}</p></div>
          <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
            {full && <span className="text-[11px] font-bold text-red-500 uppercase">{t('portail.full')}</span>}
            {urgent && <span className="text-[11px] font-bold text-amber-600 animate-pulse">{trip.availableSeats} {t('portail.seatsLeftSuffix')}</span>}
            {!full && !urgent && <span className="text-[11px] text-slate-400">{trip.availableSeats} {t('portail.availableSeats')}</span>}
            <button disabled={full} onClick={() => onBook(trip)} className={cn('px-5 sm:px-6 py-2.5 rounded-xl text-sm font-semibold transition-all w-full sm:w-auto',
              full ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed' : isVip ? 'text-white shadow-lg [background:linear-gradient(to_right,var(--portal-accent),var(--portal-accent-dark))] hover:brightness-110 active:scale-95' : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 active:scale-95')}>
              {full ? t('portail.unavailable') : t('portail.book')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Booking Modal (truly responsive — centered, not a bottom drawer)
// ═══════════════════════════════════════════════════════════════════════════════

type BookingStep = 'passengers' | 'payment' | 'confirmation';

interface TicketResult {
  bookingRef: string;
  ticketId: string;
  status: string;
  qrCode: string;
  fareClass: string;
  seatNumber: string | null;
  passenger: { firstName: string; lastName: string };
  documents: { ticketStubUrl: string | null; invoiceUrl: string | null };
}

interface BookingResult {
  tickets: TicketResult[];
  trip: { departure: string; arrival: string; departureTime: string; arrivalTime: string; routeName: string; price: number };
  totalPrice: number;
  paymentMethod: string;
}

const emptyPassenger = (): Partial<PassengerInfo> => ({ seatType: 'STANDARD' });

function BookingModal({ trip, paymentMethods, apiBase, passengerCount, onClose }: { trip: TripResult; paymentMethods: PaymentMethod[]; apiBase: string | null; passengerCount: number; onClose: () => void }) {
  const { t } = useI18n();
  const fmt = useCurrencyFormatter();
  const count = Math.max(1, Math.min(passengerCount, 8));
  const [step, setStep] = useState<BookingStep>('passengers');
  const [passengers, setPassengers] = useState<Partial<PassengerInfo>[]>(() => Array.from({ length: count }, emptyPassenger));
  const [selectedPayment, setSelectedPayment] = useState('');
  const [booking, setBooking] = useState<BookingResult | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const steps: BookingStep[] = ['passengers', 'payment', 'confirmation'];
  const ci = steps.indexOf(step);
  const isVip = trip.busType === 'VIP';
  const subtotal = trip.price * count;
  const fee = Math.round(subtotal * 0.03);
  const total = subtotal + fee;

  const updatePassenger = (idx: number, patch: Partial<PassengerInfo>) =>
    setPassengers(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));

  const allPassengersValid = passengers.every(p => p.firstName && p.lastName && p.phone);

  async function handlePay() {
    if (!apiBase || !selectedPayment) return;
    setBookingLoading(true);
    setBookingError(null);
    try {
      const result = await apiFetch<BookingResult>(`${apiBase}/booking`, {
        method: 'POST',
        skipRedirectOn401: true,
        body: {
          tripId: trip.id,
          passengers: passengers.map(p => ({
            firstName: p.firstName ?? '',
            lastName:  p.lastName ?? '',
            phone:     p.phone ?? '',
            email:     p.email,
            seatType:  p.seatType ?? 'STANDARD',
          })),
          paymentMethod: selectedPayment,
        },
      });
      setBooking(result);
      setStep('confirmation');
    } catch (err) {
      setBookingError(err instanceof Error ? err.message : t('portail.bookingError'));
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 lg:p-8">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl max-h-[92vh] flex flex-col border border-slate-200/50 dark:border-slate-700/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-8 pt-5 sm:pt-6 pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="min-w-0"><p className="font-bold text-slate-900 dark:text-white text-base sm:text-lg truncate">{trip.departure} &rarr; {trip.arrival}</p><p className="text-sm text-slate-500 mt-0.5 truncate">{fmtTime(trip.departureTime)} &middot; {trip.busModel} &middot; {count > 1 ? `${count} ${t('portail.passengers')}` : fmt(trip.price)}</p></div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors shrink-0 ml-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
        {/* Progress */}
        <div className="px-5 sm:px-8 py-3 sm:py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-1">{steps.map((s, i) => (
            <div key={s} className="flex items-center gap-1 flex-1 last:flex-none">
              <div className={cn('w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                ci > i ? 'bg-emerald-500 text-white' : ci === i ? (isVip ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white' : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900') : 'bg-slate-100 dark:bg-slate-800 text-slate-400')}>
                {ci > i ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg> : i + 1}
              </div>
              <span className={cn('text-xs font-medium hidden sm:block ml-1', ci === i ? 'text-slate-800 dark:text-white' : 'text-slate-400')}>
                {s === 'passengers' ? t('portail.passengers') : s === 'payment' ? t('portail.payment') : t('portail.confirmation')}
              </span>
              {i < 2 && <div className={cn('flex-1 h-0.5 rounded-full mx-2', ci > i ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700')} />}
            </div>
          ))}</div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-8">
          {step === 'passengers' && (
            <div className="space-y-6">
              {passengers.map((pax, idx) => (
                <div key={idx} className={cn('space-y-4', count > 1 && 'bg-slate-50 dark:bg-slate-800/30 rounded-2xl p-4 sm:p-5 border border-slate-100 dark:border-slate-700/50')}>
                  {count > 1 && <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('portail.passengerN').replace('{n}', String(idx + 1))}</p>}
                  {idx === 0 && <div><h3 className="font-semibold text-slate-900 dark:text-white text-base sm:text-lg">{t('portail.passengerInfo')}</h3><p className="text-sm text-slate-500 mt-1">{t('portail.passengerInfoDesc')}</p></div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Inp label={t('portail.firstName')} ph="Jean" value={pax.firstName || ''} set={v => updatePassenger(idx, { firstName: v })} />
                    <Inp label={t('portail.lastName')} ph="Makaya" value={pax.lastName || ''} set={v => updatePassenger(idx, { lastName: v })} />
                  </div>
                  <Inp label={t('portail.phoneLabel')} ph="+242 06 000 00 00" value={pax.phone || ''} set={v => updatePassenger(idx, { phone: v })} />
                  <Inp label={t('portail.emailOptional')} ph="jean@exemple.com" type="email" value={pax.email || ''} set={v => updatePassenger(idx, { email: v })} />
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">{t('portail.seatType')}</label>
                    <div className="grid grid-cols-2 gap-3">{(['STANDARD', 'VIP'] as const).map(type => (
                      <button key={type} onClick={() => updatePassenger(idx, { seatType: type })} className={cn('relative p-3 sm:p-4 rounded-2xl border-2 text-sm font-medium transition-all text-left',
                        pax.seatType === type ? (type === 'VIP' ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' : 'border-slate-900 dark:border-white bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white') : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300')}>
                        <span className="text-lg block mb-1">{type === 'VIP' ? '\u2605' : '\u25CB'}</span><span className="font-bold">{type}</span><span className="block text-xs mt-0.5 opacity-70">{type === 'VIP' ? t('portail.vipDesc') : t('portail.standardDesc')}</span>
                      </button>
                    ))}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {step === 'payment' && (
            <div className="space-y-5">
              <div><h3 className="font-semibold text-slate-900 dark:text-white text-base sm:text-lg">{t('portail.payment')}</h3><p className="text-sm text-slate-500 mt-1">{t('portail.selectPayment')}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 sm:p-5 space-y-3 border border-slate-100 dark:border-slate-700/50">
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">{t('portail.ticket')} {trip.departure} &rarr; {trip.arrival} &times; {count}</span><span className="font-semibold text-slate-900 dark:text-white">{fmt(subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">{t('portail.serviceFee')} (3%)</span><span className="font-semibold text-slate-900 dark:text-white">{fmt(fee)}</span></div>
                <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex justify-between"><span className="font-bold text-slate-900 dark:text-white">{t('portail.total')}</span><span className={cn('text-lg sm:text-xl font-bold', isVip ? '[color:var(--portal-accent)]' : 'text-slate-900 dark:text-white')}>{fmt(total)}</span></div>
              </div>
              <div className="space-y-2"><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('portail.paymentMethod')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{paymentMethods.map(pm => (
                  <label key={pm.providerId} className={cn('flex items-center gap-3 p-3 sm:p-4 rounded-2xl border-2 cursor-pointer transition-all',
                    selectedPayment === pm.providerId ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300')}>
                    <input type="radio" name="payment" value={pm.providerId} checked={selectedPayment === pm.providerId} onChange={e => setSelectedPayment(e.target.value)} className="sr-only" />
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0', PAYMENT_COLORS[pm.providerId] || 'bg-slate-500')}>{pm.displayName[0]}</div>
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800 dark:text-white truncate">{pm.displayName}</p><p className="text-xs text-slate-400 truncate">{pm.type === 'MOBILE_MONEY' ? `${t('portail.mobileMoney')} ${pm.phonePrefix || ''}` : t('portail.bankCard')}</p></div>
                  </label>
                ))}</div>
              </div>
            </div>
          )}
          {step === 'confirmation' && booking && (
            <div className="text-center space-y-6 py-2 sm:py-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-emerald-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/30"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <div><h3 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.bookingConfirmed')}</h3><p className="text-slate-500 text-sm mt-2 max-w-xs mx-auto">{booking.tickets.length > 1 ? t('portail.ticketsSentSms').replace('{count}', String(booking.tickets.length)) : t('portail.ticketSentSms')}</p></div>
              {booking.tickets.map((tk, idx) => (
                <div key={tk.ticketId} className="space-y-4">
                  {booking.tickets.length > 1 && <p className="text-xs font-bold text-slate-500 uppercase tracking-widest pt-2">{t('portail.passengerN').replace('{n}', String(idx + 1))}</p>}
                  <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl p-5 sm:p-6 text-white"><p className="text-xs uppercase tracking-[0.2em] font-semibold text-slate-400 mb-2">{t('portail.ticketCodeLabel')}</p><p className="text-2xl sm:text-3xl font-mono font-black tracking-[0.15em]">{tk.bookingRef}</p></div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 sm:p-5 text-left space-y-3 border border-slate-100 dark:border-slate-700/50">
                    <IRow l={t('portail.trip')} v={`${booking.trip.departure} \u2192 ${booking.trip.arrival}`} />
                    <IRow l={t('portail.departure')} v={fmtTime(booking.trip.departureTime)} />
                    <IRow l={t('portail.busLabel')} v={trip.busModel} />
                    <IRow l={t('portail.passenger')} v={`${tk.passenger.firstName} ${tk.passenger.lastName}`.trim()} />
                    <IRow l={t('portail.fareClassLabel')} v={tk.fareClass} />
                    {tk.seatNumber && <IRow l={t('portail.seatLabel')} v={tk.seatNumber} />}
                    <IRow l={t('portail.total')} v={fmt(booking.trip.price)} hl />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
                    {tk.documents.ticketStubUrl && (
                      <a href={tk.documents.ticketStubUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-sm hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 transition-all">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        {t('portail.downloadTicket')}
                      </a>
                    )}
                    {tk.documents.invoiceUrl && (
                      <a href={tk.documents.invoiceUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:border-slate-300 hover:bg-slate-50 transition-all">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        {t('portail.downloadInvoice')}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Footer */}
        <div className="px-5 sm:px-8 pb-5 sm:pb-6 pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
          {step === 'passengers' && <button onClick={() => setStep('payment')} disabled={!allPassengersValid} className={cn('w-full py-3 sm:py-3.5 rounded-xl font-semibold text-sm transition-all', allPassengersValid ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed')}>{t('portail.continueToPayment')}</button>}
          {step === 'payment' && (
            <div className="space-y-3">
              {bookingError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">{bookingError}</div>
              )}
              <div className="flex gap-3">
                <button onClick={() => setStep('passengers')} disabled={bookingLoading} className="flex-1 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-50">{t('portail.back')}</button>
                <button onClick={handlePay} disabled={!selectedPayment || bookingLoading} className={cn('flex-1 py-3 rounded-xl font-semibold text-sm transition-all', selectedPayment && !bookingLoading ? 'text-white shadow-lg [background:linear-gradient(to_right,var(--portal-accent),var(--portal-accent-dark))] hover:brightness-110' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed')}>
                  {bookingLoading ? (
                    <span className="flex items-center justify-center gap-2"><svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>{t('portail.processing')}</span>
                  ) : (
                    <>{t('portail.pay')} {fmt(total)}</>
                  )}
                </button>
              </div>
            </div>
          )}
          {step === 'confirmation' && <button onClick={onClose} className="w-full py-3 sm:py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold text-sm hover:bg-slate-800">{t('portail.closeLabel')}</button>}
        </div>
      </div>
    </div>
  );
}

function Inp({ label, ph, type = 'text', value, set }: { label: string; ph: string; type?: string; value: string; set: (v: string) => void }) {
  return <div><label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">{label}</label><input type={type} placeholder={ph} value={value} onChange={e => set(e.target.value)} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white placeholder:text-slate-400 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)] focus:border-amber-500 transition-all" /></div>;
}
function IRow({ l, v, hl }: { l: string; v: string; hl?: boolean }) {
  return <div className="flex justify-between text-sm"><span className="text-slate-500">{l}</span><span className={cn('font-semibold', hl ? '[color:var(--portal-accent)]' : 'text-slate-800 dark:text-white')}>{v}</span></div>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Nearby Stations
// ═══════════════════════════════════════════════════════════════════════════════

function NearbyStations({ stations, t }: { stations: StationInfo[]; t: (k: string) => string }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [city, setCity] = useState('');
  const [gps, setGps] = useState<'idle' | 'loading' | 'denied' | 'found'>('idle');

  const reqGps = useCallback(() => {
    if (!navigator.geolocation) { setGps('denied'); return; }
    setGps('loading');
    navigator.geolocation.getCurrentPosition(
      p => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setGps('found'); },
      () => setGps('denied'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // All stations with coordinates
  const geoStations = stations.filter(s => s.coordinates);

  // Filtered + sorted
  const displayed = pos
    ? geoStations.map(s => ({ ...s, dist: haversineKm(pos, s.coordinates!) })).sort((a, b) => a.dist - b.dist).slice(0, 15)
    : city.trim()
      ? geoStations.filter(s => s.city.toLowerCase().includes(city.toLowerCase()) || s.name.toLowerCase().includes(city.toLowerCase())).map(s => ({ ...s, dist: undefined as number | undefined }))
      : geoStations.map(s => ({ ...s, dist: undefined as number | undefined })); // show ALL by default

  // Map center
  const center: [number, number] = pos
    ? [pos.lat, pos.lng]
    : displayed.length > 0 && displayed[0].coordinates
      ? [displayed[0].coordinates.lat, displayed[0].coordinates.lng]
      : [-4.2634, 15.2429];

  const zoom = pos ? 12 : city.trim() ? 11 : 6;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" />
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.nearbyTitle')}</h2>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <button onClick={reqGps} disabled={gps === 'loading'}
          className={cn('flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold transition-all border',
            gps === 'found' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-700 hover:[border-color:var(--portal-accent)]')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>
          {gps === 'loading' ? t('portail.locating') : gps === 'found' ? t('portail.located') : t('portail.useMyLocation')}
        </button>
        <input placeholder={t('portail.searchCityPlaceholder')} value={city}
          onChange={e => { setCity(e.target.value); setPos(null); setGps('idle'); }}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]" />
      </div>

      {gps === 'denied' && <p className="text-sm text-red-500 mb-4">{t('portail.gpsDenied')}</p>}

      {/* Station count */}
      <p className="text-xs text-slate-400 mb-3">{displayed.length} {t('portail.stationsOnMap')}</p>

      {/* Full-width map — stations as markers (like Google Maps POI) */}
      {geoStations.length > 0 && (
        <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800" style={{ height: 480 }}>
          <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <RecenterMap center={center} zoom={zoom} />
            {/* User position — blue dot */}
            {pos && (
              <Marker position={[pos.lat, pos.lng]} icon={L.divIcon({
                className: '',
                html: '<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(59,130,246,0.6)"></div>',
                iconSize: [16, 16], iconAnchor: [8, 8],
              })}>
                <Popup><strong>{t('portail.yourPosition')}</strong></Popup>
              </Marker>
            )}
            {/* Station markers */}
            {displayed.filter(s => s.coordinates).map((s, i) => (
              <Marker key={i} position={[s.coordinates!.lat, s.coordinates!.lng]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="background:${s.type === 'PRINCIPALE' ? '#d97706' : '#64748b'};color:white;font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${s.name}</div>`,
                  iconSize: [0, 0], iconAnchor: [0, 14],
                })}>
                <Popup>
                  <div style={{ minWidth: 200, fontFamily: 'Inter, system-ui, sans-serif' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{s.name}</div>
                    <div style={{ color: '#64748b', fontSize: 11, marginBottom: 6 }}>{s.city} — <span style={{ color: s.type === 'PRINCIPALE' ? '#d97706' : '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 10 }}>{s.type}</span></div>
                    {s.dist !== undefined && <div style={{ color: '#d97706', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{s.dist.toFixed(1)} km</div>}
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${s.coordinates!.lat},${s.coordinates!.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-block', background: '#1e293b', color: 'white', padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, textDecoration: 'none', marginTop: 2 }}
                    >
                      {t('portail.goThere')} &rarr;
                    </a>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}

      {geoStations.length === 0 && <p className="text-sm text-slate-400 text-center py-12">{t('portail.noStationsFound')}</p>}
    </div>
  );
}

function RecenterMap({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [center, zoom, map]);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Parcel Section
// ═══════════════════════════════════════════════════════════════════════════════

function ParcelSection({ t, fmt }: { t: (k: string) => string; fmt: (n: number) => string }) {
  const [tab, setTab] = useState<'track' | 'send'>('track');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<{ status: string; from: string; to: string; date: string } | null>(null);
  const [tracked, setTracked] = useState(false);
  const track = (e: FormEvent) => { e.preventDefault(); setResult({ status: 'IN_TRANSIT', from: 'Brazzaville', to: 'Pointe-Noire', date: new Date().toISOString() }); setTracked(true); };
  return (
    <div>
      <div className="flex items-center gap-3 mb-6"><div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" /><h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.parcelTitle')}</h2></div>
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-6 max-w-xs">
        {(['track', 'send'] as const).map(tb => <button key={tb} onClick={() => { setTab(tb); setTracked(false); }} className={cn('flex-1 py-2 rounded-lg text-sm font-semibold transition-all', tab === tb ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700')}>{tb === 'track' ? t('portail.trackParcel') : t('portail.sendParcel')}</button>)}
      </div>
      {tab === 'track' && (
        <div className="max-w-lg">
          <form onSubmit={track} className="flex flex-col sm:flex-row gap-3">
            <input placeholder={t('portail.trackingPlaceholder')} value={code} onChange={e => setCode(e.target.value)} className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]" />
            <button type="submit" disabled={!code.trim()} className="px-6 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all">{t('portail.track')}</button>
          </form>
          {tracked && result && (
            <div className="mt-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl [background:var(--portal-accent-light)] flex items-center justify-center"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg></div>
                <div><p className="font-bold text-slate-900 dark:text-white text-sm">{code}</p><span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold uppercase">{t('portail.inTransit')}</span></div>
              </div>
              <div className="space-y-2"><IRow l={t('portail.departure')} v={result.from} /><IRow l={t('portail.arrival')} v={result.to} /><IRow l={t('portail.dateLabel')} v={fmtDate(result.date)} /></div>
            </div>
          )}
        </div>
      )}
      {tab === 'send' && (
        <div className="max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <p className="text-sm text-slate-500 mb-4">{t('portail.sendParcelDesc')}</p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><Inp label={t('portail.senderName')} ph="Jean Makaya" value="" set={() => {}} /><Inp label={t('portail.senderPhone')} ph="+242 06 000 00 00" value="" set={() => {}} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><Inp label={t('portail.recipientName')} ph="Marie Mouanda" value="" set={() => {}} /><Inp label={t('portail.recipientPhone')} ph="+242 05 000 00 00" value="" set={() => {}} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><Inp label={t('portail.fromCity')} ph="Brazzaville" value="" set={() => {}} /><Inp label={t('portail.toCity')} ph="Pointe-Noire" value="" set={() => {}} /></div>
            <Inp label={t('portail.parcelDescription')} ph={t('portail.parcelDescPlaceholder')} value="" set={() => {}} />
            <button className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-sm hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 transition-all">{t('portail.requestPickup')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fleet Section with seatmap detail
// ═══════════════════════════════════════════════════════════════════════════════

interface FleetBus {
  model: string; type: string | null; capacity: number;
  year: number | null; photos: string[]; seatLayout: unknown;
}

function FleetSection({ t, apiBase }: { t: (k: string) => string; apiBase: string | null }) {
  const fleetRes = useFetch<FleetBus[]>(apiBase ? `${apiBase}/fleet` : null, [apiBase], { skipRedirectOn401: true });
  const fleet = fleetRes.data ?? [];
  const [selectedBus, setSelectedBus] = useState<FleetBus | null>(null);
  const rows = (bus: FleetBus) => Math.ceil(bus.capacity / 4);

  return (
    <div>
      <div className="flex items-center gap-3 mb-8"><div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" /><h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.fleetTitle')}</h2></div>
      {fleetRes.loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-[3px] border-slate-200 border-t-amber-500 rounded-full animate-spin" /></div>
      ) : fleet.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-12">{t('portail.noFleet')}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {fleet.map((bus, i) => (
            <button key={i} onClick={() => setSelectedBus(bus)} className="group bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-xl hover:[border-color:var(--portal-accent)] transition-all text-left">
              <div className="h-40 sm:h-48 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center relative overflow-hidden">
                {bus.photos.length > 0 ? (
                  <img src={bus.photos[0]} alt={bus.model} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <svg className="w-32 h-20 opacity-30 group-hover:opacity-50 transition-all duration-500" viewBox="0 0 200 80" fill="none">
                    <rect x="10" y="20" width="180" height="45" rx="8" fill="currentColor" className="text-slate-400" />
                    <rect x="20" y="10" width="140" height="20" rx="5" fill="currentColor" className="text-slate-300" />
                    <circle cx="50" cy="70" r="10" fill="currentColor" className="text-slate-500" />
                    <circle cx="150" cy="70" r="10" fill="currentColor" className="text-slate-500" />
                  </svg>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                {bus.type === 'VIP' && <div className="absolute top-3 right-3 px-2.5 py-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg">VIP</div>}
                {bus.photos.length > 1 && <span className="absolute bottom-2 right-2 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full">{bus.photos.length} photos</span>}
              </div>
              <div className="p-4 sm:p-5">
                <h3 className="font-bold text-slate-900 dark:text-white">{bus.model}</h3>
                <p className="text-xs text-slate-500 mt-1">{bus.capacity} {t('portail.seats')}{bus.year ? ` \u00b7 ${bus.year}` : ''}{bus.type ? ` \u00b7 ${bus.type}` : ''}</p>
                <p className="text-xs text-amber-600 font-semibold mt-3">{t('portail.viewSeatmap')} &rarr;</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Bus detail + seatmap modal */}
      {selectedBus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md" onClick={() => setSelectedBus(null)} />
          <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto border border-slate-200/50 dark:border-slate-700/50">
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white">{selectedBus.model}</h3>
                  <p className="text-sm text-slate-500 mt-1">{selectedBus.type || ''} &middot; {selectedBus.capacity} {t('portail.seats')}{selectedBus.year ? ` \u00b7 ${selectedBus.year}` : ''}</p>
                </div>
                <button onClick={() => setSelectedBus(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>

              {/* Seatmap */}
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 border border-slate-200 dark:border-slate-700/50">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">{t('portail.seatmapTitle')}</p>
                {/* Driver area */}
                <div className="flex justify-center mb-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 dark:text-slate-400"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>
                  </div>
                </div>
                {/* Seat grid — uses real seatLayout from DB */}
                {(() => {
                  const layout = selectedBus.seatLayout as { rows: number; cols: number; disabled?: string[]; aisleAfter?: number } | null;
                  const r = layout?.rows ?? rows(selectedBus);
                  const c = layout?.cols ?? 4;
                  const aisle = layout?.aisleAfter ?? 2;
                  const disabled = new Set(layout?.disabled ?? []);
                  return (
                    <div className="flex flex-col items-center gap-1.5">
                      {Array.from({ length: r }).map((_, row) => (
                        <div key={row} className="flex items-center gap-1.5">
                          {Array.from({ length: c }).map((_, col) => {
                            const seatKey = `${row + 1}-${col + 1}`;
                            const seatNum = row * c + col + 1;
                            const isDis = disabled.has(seatKey);
                            return (
                              <>{col === aisle && <div className="w-4" />}
                              <div key={col} className={cn('w-7 h-7 rounded flex items-center justify-center text-[9px] font-bold',
                                isDis ? 'bg-slate-200 dark:bg-slate-700 text-slate-400' : 'bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300/50 text-emerald-700 dark:text-emerald-400'
                              )}>{isDis ? '\u00d7' : seatNum}</div></>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* Legend */}
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-300/50" />{t('portail.seatAvailable')}</div>
                  <div className="flex items-center gap-1.5"><div className="w-4 h-4 rounded bg-slate-200" />{'\u00d7'}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

type Section = 'booking' | 'parcels' | 'nearby' | 'about' | 'fleet' | 'contact';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={toggle} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
      {theme === 'dark' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      )}
    </button>
  );
}

export function PortailVoyageur() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { t, lang } = useI18n();
  const fmt = useCurrencyFormatter();
  const { theme, toggle: toggleTheme } = useTheme();

  // Force light mode on first mount for the public portal
  const portalInitRef = useRef(false);
  useEffect(() => {
    if (!portalInitRef.current) {
      portalInitRef.current = true;
      if (theme === 'dark') toggleTheme();
    }
  }, [theme, toggleTheme]);

  const apiBase = tenantSlug ? `/api/public/${tenantSlug}/portal` : null;
  const skip = useMemo(() => ({ skipRedirectOn401: true } as const), []);
  const cfgUrl = apiBase ? `${apiBase}/config` : null;
  const stUrl = apiBase ? `${apiBase}/stations` : null;
  const cfgDeps = useMemo(() => [tenantSlug], [tenantSlug]);
  const cfg = useFetch<{ tenant: { name: string; contact: Record<string, string> }; brand: { brandName: string; logoUrl?: string }; paymentMethods: PaymentMethod[]; portal?: { themeId?: string } | null }>(cfgUrl, cfgDeps, skip);
  const stRes = useFetch<StationInfo[]>(stUrl, cfgDeps, skip);
  // Tenant name takes priority — brand.brandName is only used if tenant specifically set it
  const brandName = cfg.data?.tenant?.name || cfg.data?.brand?.brandName || '';
  const brandLogo = cfg.data?.brand?.logoUrl;
  const stations = stRes.data ?? [];
  const pms = cfg.data?.paymentMethods ?? DEMO_PAYMENT_METHODS; // payment methods fallback OK (country-specific)

  // Derive unique cities from stations, sorted by frequency (most routes first)
  const citiesKey = stations.map(s => s.city).join(',');
  const cities = useMemo(() => [...new Set(stations.map(s => s.city))].sort(), [citiesKey]);
  const cityOptions: ComboboxOption[] = useMemo(() => {
    const freq = new Map<string, number>();
    for (const s of stations) freq.set(s.city, (freq.get(s.city) ?? 0) + 1);
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([city]) => ({ value: city, label: city }));
  }, [stations]);

  const [dep, setDep] = useState('');
  const [arr, setArr] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [pax, setPax] = useState(1);
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState<'price' | 'time'>('time');
  const [selTrip, setSelTrip] = useState<TripResult | null>(null);
  const [section, setSection] = useState<Section>('booking');
  const [mobileNav, setMobileNav] = useState(false);
  const [results, setResults] = useState<TripResult[]>([]);
  const [loading, setLoading] = useState(false);

  // ── Trip dates for calendar highlights ──
  const [calMonth, setCalMonth] = useState(() => date.slice(0, 7));
  const tripDatesUrl = apiBase ? `${apiBase}/trips/dates?month=${calMonth}` : null;
  const tripDatesDeps = useMemo(() => [tenantSlug, calMonth], [tenantSlug, calMonth]);
  const { data: tripDatesRaw, loading: tripDatesLoading } = useFetch<string[]>(tripDatesUrl, tripDatesDeps, skip);
  const tripDatesSet = useMemo(() => new Set(tripDatesRaw ?? []), [tripDatesRaw]);

  const initDone = useRef(false);

  // Set default cities ONCE when stations load — not on every render
  useEffect(() => {
    if (!initDone.current && cities.length >= 2) {
      setDep(cities[0]);
      setArr(cities[1]);
      initDone.current = true;
    }
  }, [cities]);

  const doSearch = useCallback(async (e: FormEvent) => {
    e.preventDefault(); setSearched(true); setSection('booking'); setLoading(true);
    try { const r = await apiFetch<TripResult[]>(`${apiBase}/trips/search?${new URLSearchParams({ departure: dep, arrival: arr, date, passengers: String(pax) })}`, { method: 'GET', skipRedirectOn401: true }); setResults(r); }
    catch { setResults([]); } finally { setLoading(false); }
  }, [apiBase, dep, arr, date, pax]);

  const quick = useCallback(async (f: string, to: string) => {
    setDep(f); setArr(to); setSearched(true); setSection('booking'); setLoading(true);
    try { const r = await apiFetch<TripResult[]>(`${apiBase}/trips/search?${new URLSearchParams({ departure: f, arrival: to, date, passengers: String(pax) })}`, { method: 'GET', skipRedirectOn401: true }); setResults(r); }
    catch { setResults([]); } finally { setLoading(false); }
  }, [apiBase, date, pax]);
  const swap = useCallback(() => { setDep(arr); setArr(dep); }, [dep, arr]);
  const sorted = searched ? [...results].sort((a, b) => sort === 'price' ? a.price - b.price : a.departureTime.localeCompare(b.departureTime)) : [];

  // Resolve portal theme from tenant config (persisted in DB)
  const portalTheme = useMemo(() => getTheme(cfg.data?.portal?.themeId), [cfg.data?.portal?.themeId]);

  const NAV: { key: Section; label: string }[] = [
    { key: 'booking', label: t('portail.navBooking') }, { key: 'parcels', label: t('portail.navParcels') }, { key: 'nearby', label: t('portail.navNearby') },
    { key: 'about', label: t('portail.navAbout') }, { key: 'fleet', label: t('portail.navFleet') }, { key: 'contact', label: t('portail.navContact') },
  ];

  const layout = portalTheme.layout;
  const navItems: LayoutNavItem[] = NAV;
  const handleSection = (key: string) => { setSection(key as Section); if (key !== 'booking') setSearched(false); };
  const handleHome = () => { setSection('booking'); setSearched(false); setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // Layout-aware section title
  const STitle = ({ title }: { title: string }) => {
    const p = { title, accent: portalTheme.accent, accentDark: portalTheme.accentDark };
    if (layout === 'horizon') return <HorizonSectionTitle {...p} />;
    if (layout === 'vivid') return <VividSectionTitle {...p} />;
    if (layout === 'prestige') return <PrestigeSectionTitle {...p} />;
    return <div className="flex items-center gap-3 mb-6"><div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" /><h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{title}</h2></div>;
  };

  return (
    <PortalThemeCtx.Provider value={portalTheme}>
    <div
      className="min-h-screen flex flex-col bg-white dark:bg-slate-950 font-sans antialiased"
      style={{
        '--portal-accent': portalTheme.accent,
        '--portal-accent-light': portalTheme.accentLight,
        '--portal-accent-dark': portalTheme.accentDark,
        '--portal-secondary': portalTheme.secondary,
      } as React.CSSProperties}
    >
      {/* ── Navbar (layout-variant) ────────────────────────────── */}
      {layout === 'horizon' ? (
        <HorizonNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={t('portail.login')} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'vivid' ? (
        <VividNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={t('portail.login')} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'prestige' ? (
        <PrestigeNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={t('portail.login')} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : (
        /* Classic navbar (original) */
        <nav className="sticky top-0 z-40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
          <div className="max-w-6xl mx-auto flex items-center justify-between h-14 sm:h-16 px-4 sm:px-6">
            <button onClick={handleHome} className="flex items-center gap-2.5 shrink-0 hover:opacity-80 transition-opacity">
              {brandLogo ? <img src={brandLogo} alt={brandName} className="w-9 h-9 rounded-xl object-cover" /> : <div className="w-9 h-9 rounded-xl bg-[image:linear-gradient(to_bottom_right,var(--portal-accent),var(--portal-accent-dark))] flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-amber-500/20">{brandName.charAt(0) || 'T'}</div>}
              <span className="font-bold text-slate-900 dark:text-white text-base sm:text-lg tracking-tight hidden sm:block">{brandName}</span>
            </button>
            <div className="hidden md:flex items-center gap-0.5 mx-4">
              {NAV.map(n => <button key={n.key} onClick={() => handleSection(n.key)} className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap', section === n.key ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300')}>{n.label}</button>)}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <ThemeToggle />
              <LanguageSwitcher />
              <button className="hidden sm:block text-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-xl font-semibold hover:bg-slate-800 transition-colors shadow-sm ml-1">{t('portail.login')}</button>
              <button onClick={() => setMobileNav(v => !v)} className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1" aria-label={mobileNav ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={mobileNav}>
                {mobileNav ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>}
              </button>
            </div>
          </div>
          {mobileNav && (
            <div className="md:hidden border-t border-slate-200/50 dark:border-slate-800/50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl animate-in slide-in-from-top-2 duration-150">
              <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
                {NAV.map(n => <button key={n.key} onClick={() => { handleSection(n.key); setMobileNav(false); }} className={cn('w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-colors', section === n.key ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50')}>{n.label}</button>)}
                <button className="sm:hidden w-full mt-2 text-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-xl font-semibold hover:bg-slate-800 transition-colors shadow-sm text-center">{t('portail.login')}</button>
              </div>
            </div>
          )}
        </nav>
      )}

      {/* ── Hero (layout-variant) ────────────────────────────── */}
      {section === 'booking' && !searched && (() => {
        const searchFormEl = (
          <form onSubmit={doSearch}>
            <div className={cn('grid gap-3 items-end', layout === 'vivid' ? 'grid-cols-1 sm:grid-cols-2' : layout === 'prestige' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto]' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_auto_auto]')}>
              <ComboboxEditable label={t('portail.departure')} value={dep} onChange={setDep} options={cityOptions} placeholder={t('portail.selectCity')} labelClassName="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5" inputClassName="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]" />
              {layout !== 'vivid' && layout !== 'prestige' && <button type="button" onClick={swap} className="self-end mb-0.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:bg-amber-50 hover:text-amber-600 hover:[border-color:var(--portal-accent)] transition-all hidden lg:flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 16l-4-4m0 0l4-4m-4 4h18M17 8l4 4m0 0l-4 4m4-4H3"/></svg></button>}
              <ComboboxEditable label={t('portail.arrival')} value={arr} onChange={setArr} options={cityOptions} placeholder={t('portail.selectCity')} labelClassName="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5" inputClassName="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]" />
              <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('portail.dateLabel')}</label><TripDatePicker value={date} onChange={setDate} tripDates={tripDatesSet} loading={tripDatesLoading} locale={lang === 'ar' ? 'ar-SA' : 'fr-FR'} t={t} onMonthChange={setCalMonth} /></div>
              {layout !== 'vivid' && <div><label className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('portail.passengers')}</label><select value={pax} onChange={e => setPax(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]">{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}</select></div>}
              <button type="submit" className={cn('self-end text-white rounded-xl px-6 py-3 font-bold shadow-lg whitespace-nowrap text-sm active:scale-95 transition-all', layout === 'vivid' ? 'sm:col-span-2' : '')} style={{ background: `linear-gradient(to right, ${portalTheme.accent}, ${portalTheme.accentDark})` }}>{t('portail.search')}</button>
            </div>
          </form>
        );
        const heroStats = [{ value: '50K+', label: t('portail.statPassengers') }, { value: '120+', label: t('portail.statRoutes') }, { value: '99%', label: t('portail.statSatisfaction') }];

        if (layout === 'horizon') return <HorizonHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={t('portail.heroTitle')} subtitle={t('portail.heroSubtitle')} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;
        if (layout === 'vivid') return <VividHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={t('portail.heroTitle')} subtitle={t('portail.heroSubtitle')} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;
        if (layout === 'prestige') return <PrestigeHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={t('portail.heroTitle')} subtitle={t('portail.heroSubtitle')} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;

        // Classic hero (original)
        return (
          <HeroCarousel>
            <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-20">
              <div className="flex items-center gap-2 mb-4 sm:mb-6">{[1,2,3,4,5].map(i => <span key={i} className="text-amber-400 text-sm">{'\u2605'}</span>)}<span className="text-sm text-slate-400 font-medium">{t('portail.trustedBy')}</span></div>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight max-w-2xl">{t('portail.heroTitle')}</h1>
              <p className="text-base sm:text-xl text-slate-400 mt-3 sm:mt-4 max-w-xl leading-relaxed">{t('portail.heroSubtitle')}</p>
              <div className="mt-8 sm:mt-10 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl shadow-black/20 border border-white/5">{searchFormEl}</div>
              <div className="flex items-center justify-center gap-6 sm:gap-12 mt-8 sm:mt-10 text-center">
                {heroStats.map(s => <div key={s.label}><p className="text-xl sm:text-3xl font-black text-white">{s.value}</p><p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 font-medium uppercase tracking-wider">{s.label}</p></div>)}
              </div>
            </div>
          </HeroCarousel>
        );
      })()}

      {/* Content — flex-1 so footer always sticks to bottom */}
      <div className="flex-1">
      <div className={cn('max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-14', layout === 'horizon' && section === 'booking' && !searched && 'pt-20 sm:pt-24')}>
        {section === 'booking' && (<>
          {!searched ? (
            <div>
              <STitle title={t('portail.popularTrips')} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{POPULAR_ROUTES.map(r => (
                <button key={`${r.from}-${r.to}`} onClick={() => quick(r.from, r.to)} className="group relative bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 hover:[border-color:var(--portal-accent)] hover:shadow-xl hover:shadow-amber-500/5 transition-all text-left overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2 group-hover:scale-150 transition-transform duration-500" />
                  <p className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-600 transition-colors">{r.from} &rarr; {r.to}</p>
                  <div className="flex items-center gap-2 mt-2"><span className="text-xs font-semibold [color:var(--portal-accent)]">{t('portail.from')} {fmt(r.price)}</span><span className="text-xs text-slate-400">&middot; {r.duration}</span></div>
                </button>
              ))}</div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                <div>
                  <div className="flex items-center gap-3"><button onClick={() => setSearched(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button><h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">{dep} &rarr; {arr}</h2></div>
                  <p className="text-sm text-slate-500 mt-1 ml-10">{fmtDate(date, lang === 'ar' ? 'ar-SA' : 'fr-FR')} &bull; {sorted.filter(r => r.canBook).length} {t('portail.tripsAvailable')}</p>
                </div>
                <select value={sort} onChange={e => setSort(e.target.value as any)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]"><option value="time">{t('portail.sortDeparture')}</option><option value="price">{t('portail.sortPrice')}</option></select>
              </div>
              <div className="space-y-4">
                {loading ? <div className="flex flex-col items-center py-16 gap-4"><div className="w-10 h-10 border-[3px] border-slate-200 dark:border-slate-700 border-t-amber-500 rounded-full animate-spin" /><p className="text-sm text-slate-400">{t('portail.searchingTrips')}</p></div>
                : sorted.length === 0 ? <div className="text-center py-16"><p className="text-lg font-semibold text-slate-400">{t('portail.noTripsFound')}</p><p className="text-sm text-slate-400 mt-1">{t('portail.tryAnotherDate')}</p></div>
                : sorted.map(trip => {
                  const variantProps: VariantTripCardProps = { trip, onBook: setSelTrip, fmt, fmtTime, fmtDuration, accent: portalTheme.accent, accentDark: portalTheme.accentDark, accentLight: portalTheme.accentLight, t };
                  if (layout === 'horizon') return <HorizonTripCard key={trip.id} {...variantProps} />;
                  if (layout === 'vivid') return <VividTripCard key={trip.id} {...variantProps} />;
                  if (layout === 'prestige') return <PrestigeTripCard key={trip.id} {...variantProps} />;
                  return <TripCard key={trip.id} trip={trip} onBook={setSelTrip} fmt={fmt} t={t} />;
                })}
              </div>
            </div>
          )}
        </>)}
        {section === 'parcels' && <ParcelSection t={t} fmt={fmt} />}
        {section === 'nearby' && <NearbyStations stations={stations} t={t} />}
        {section === 'about' && (
          <div className="max-w-3xl mx-auto"><STitle title={t('portail.aboutTitle')} />
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-3xl p-6 sm:p-10 border border-slate-200 dark:border-slate-700/50"><p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">{t('portail.aboutContent')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">{[{ i: '\u2691', t: t('portail.aboutSafety'), d: t('portail.aboutSafetyDesc') }, { i: '\u2726', t: t('portail.aboutComfort'), d: t('portail.aboutComfortDesc') }, { i: '\u2316', t: t('portail.aboutReliability'), d: t('portail.aboutReliabilityDesc') }].map(v => <div key={v.t} className="text-center p-4"><span className="text-3xl block mb-3">{v.i}</span><h4 className="font-bold text-slate-900 dark:text-white text-sm">{v.t}</h4><p className="text-xs text-slate-500 mt-1">{v.d}</p></div>)}</div></div></div>
        )}
        {section === 'fleet' && <FleetSection t={t} apiBase={apiBase} />}
        {section === 'contact' && (
          <div className="max-w-2xl mx-auto"><STitle title={t('portail.contactTitle')} />
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700/50">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">{[
                { i: '\u2706', l: t('portail.phoneLabel'), v: cfg.data?.tenant?.contact?.phone || '+242 06 000 00 00' },
                { i: '@', l: t('portail.emailLabel'), v: cfg.data?.tenant?.contact?.email || 'contact@transcongo.cg' },
                { i: '\u2302', l: t('portail.addressLabel'), v: cfg.data?.tenant?.contact?.address || 'Av. de la Paix, Brazzaville' },
                { i: '\u231A', l: t('portail.hoursLabel'), v: 'Lun-Sam: 06h-20h' },
              ].map(c => <div key={c.l} className="flex items-start gap-4"><div className="w-10 h-10 rounded-xl [background:var(--portal-accent-light)] flex items-center justify-center text-amber-600 font-bold shrink-0">{c.i}</div><div><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{c.l}</p><p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{c.v}</p></div></div>)}</div></div></div>
        )}
      </div>

      </div>{/* end flex-1 content */}

      {/* ── Footer (layout-variant) ────────────────────────────── */}
      {layout === 'horizon' ? (
        <HorizonFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'vivid' ? (
        <VividFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'prestige' ? (
        <PrestigeFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : (
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 mt-auto shrink-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
              <div><div className="flex items-center gap-2 mb-3">{brandLogo ? <img src={brandLogo} alt="" className="w-8 h-8 rounded-lg object-cover" /> : <div className="w-8 h-8 rounded-lg bg-[image:linear-gradient(to_bottom_right,var(--portal-accent),var(--portal-accent-dark))] flex items-center justify-center text-white font-bold text-xs">{brandName.charAt(0)}</div>}<span className="font-bold text-slate-900 dark:text-white">{brandName}</span></div><p className="text-xs text-slate-500 leading-relaxed">{t('portail.footerAbout')}</p></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('portail.footerLinks')}</p><div className="space-y-2">{NAV.map(n => <button key={n.key} onClick={() => handleSection(n.key)} className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600 transition-colors">{n.label}</button>)}</div></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('portail.footerLegal')}</p><div className="space-y-2"><a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600">CGV</a><a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600">{t('portail.privacy')}</a><a href="#" className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600">{t('portail.legalMentions')}</a></div></div>
            </div>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3"><p className="text-xs text-slate-400">{t('portail.copyright')}</p><p className="text-xs text-slate-400">{t('portail.poweredBy')} <span className="font-semibold text-slate-500">TranslogPro</span></p></div>
          </div>
        </footer>
      )}

      {selTrip && <BookingModal trip={selTrip} paymentMethods={pms} apiBase={apiBase} passengerCount={pax} onClose={() => setSelTrip(null)} />}
    </div>
    </PortalThemeCtx.Provider>
  );
}

export default PortailVoyageur;
