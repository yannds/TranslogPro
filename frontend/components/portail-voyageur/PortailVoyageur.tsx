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
import DOMPurify from 'dompurify';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth/auth.context';
import { resolveHost } from '../../lib/tenancy/host';
import { cn } from '../../lib/utils';
import { useCurrencyFormatter, useTenantConfig } from '../../providers/TenantConfigProvider';
import { useI18n } from '../../lib/i18n/useI18n';
import { useTheme } from '../theme/ThemeProvider';
import { apiFetch } from '../../lib/api';
import { useFetch } from '../../lib/hooks/useFetch';
import { ComboboxEditable, type ComboboxOption } from '../ui/ComboboxEditable';
import { TripDatePicker } from './TripDatePicker';
import { TripStopsTimeline, type TripStop } from './TripStopsTimeline';
import type { Language } from '../../lib/i18n/types';
import { createContext, useContext } from 'react';
import { getTheme, type PortalTheme } from './portal-themes';
import { SeatMapPicker } from '../tickets/SeatMapPicker';
import { AnnouncementTicker } from '../display/AnnouncementTicker';
import { useAnnouncements } from '../../lib/hooks/useAnnouncements';
import { CaptchaWidget } from '../ui/CaptchaWidget';
import { newIdempotencyKey } from '../../lib/captcha/useTurnstile';
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
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';

// Fix Leaflet default marker icon in bundlers (assets locaux, zéro CDN)
const defaultIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

// ─── CMS page types ──────────────────────────────────────────────────────────

interface CmsPage { slug: string; title: string; content: string; locale: string }

interface HeroStat { value: string; label: string }
interface HeroCms { title: string; subtitle: string; trustedBy: string; stats?: HeroStat[] }
interface AboutFeature { icon: string; title: string; description: string }
interface AboutCms { description: string; features: AboutFeature[] }
interface ContactCms { hours: string }

function parseCmsJson<T>(page: CmsPage | undefined): T | null {
  if (!page) return null;
  try { return JSON.parse(page.content) as T; } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentMethod {
  providerId: string;
  displayName: string;
  type: 'MOBILE_MONEY' | 'CARD';
  logoUrl?: string;
  phonePrefix?: string;
}

interface SeatLayout {
  rows: number;
  cols: number;
  aisleAfter?: number;
  disabled?: string[];
}

interface TripStopEnriched {
  stationId:    string;
  name:         string;
  city:         string;
  km:           number;
  order:        number;
  estimatedAt:  string;
  isBoarding?:  boolean;
  isAlighting?: boolean;
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
  // Backend v2 (Sprint 1) : stops enrichis avec stationId / order / estimatedAt
  // Rétrocompat : anciens stops {city,name,km} still supported.
  stops?: Array<TripStopEnriched | { city: string; name: string; km: number }>;
  boardingStationId?:     string;
  alightingStationId?:    string;
  isIntermediateSegment?: boolean;
  isAutoCalculated?:      boolean;
  seatingMode?: 'FREE' | 'NUMBERED';
  seatLayout?: SeatLayout | null;
  seatSelectionFee?: number;
  isFullVip?: boolean;
  vipSeats?: string[];
}

interface StationInfo {
  id?: string;
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
  wantsSeatSelection?: boolean;
  seatNumber?: string | null;
}

// ─── Demo data (fallback) ───────────────────────────────────────────────────

// Demo data removed — real data comes from the API

const AMENITY_I18N: Record<string, string> = {
  WIFI: 'fleetVehicles.amenityWIFI', AC: 'fleetVehicles.amenityAC',
  TOILETS: 'fleetVehicles.amenityTOILETS', USB_CHARGING: 'fleetVehicles.amenityUSB_CHARGING',
  RECLINING_SEATS: 'fleetVehicles.amenityRECLINING_SEATS', TV: 'fleetVehicles.amenityTV',
  SNACK_BAR: 'fleetVehicles.amenitySNACK_BAR', BLANKETS: 'fleetVehicles.amenityBLANKETS',
  LUGGAGE_TRACKING: 'fleetVehicles.amenityLUGGAGE_TRACKING',
};
function tAmenity(t: (k: string) => string, key: string): string {
  return AMENITY_I18N[key] ? t(AMENITY_I18N[key]) : key;
}

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

function hasEnrichedStops(stops: TripResult['stops']): stops is TripStop[] {
  return Array.isArray(stops) && stops.length > 0 && typeof (stops[0] as TripStop).stationId === 'string';
}

function TripCard({ trip, onBook, fmt, t }: { trip: TripResult; onBook: (t: TripResult) => void; fmt: (n: number) => string; t: (k: string) => string }) {
  const full = trip.availableSeats === 0, urgent = trip.availableSeats > 0 && trip.availableSeats <= 5, isVip = trip.busType === 'VIP';
  return (
    <div className={cn('group relative rounded-2xl border transition-all duration-300 bg-white dark:bg-slate-900/80 backdrop-blur-sm',
      full ? 'border-slate-200 dark:border-slate-800 opacity-60' : 'border-slate-200/80 dark:border-slate-700/50 hover:[border-color:var(--portal-accent)]/60 hover:shadow-xl hover:shadow-amber-500/5')}>
      {isVip && <div className="absolute -top-2.5 left-5 px-3 py-0.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full shadow-lg shadow-amber-500/20">VIP</div>}
      <div className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
          <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{trip.busModel}</p><p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">{trip.busType}</p></div>
          <div className="flex gap-1.5 flex-wrap">{trip.amenities.map(a => <span key={a} className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">{tAmenity(t, a)}</span>)}</div>
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
        {/* Timeline des arrêts — affichée si stops enrichis (backend v2) */}
        {Array.isArray(trip.stops) && trip.stops.length > 0 && hasEnrichedStops(trip.stops) && (
          <div className="mb-4">
            <TripStopsTimeline
              stops={trip.stops as TripStop[]}
              boardingStationId={trip.boardingStationId}
              alightingStationId={trip.alightingStationId}
              isIntermediateSegment={trip.isIntermediateSegment}
              compact
              t={t}
            />
            {trip.isAutoCalculated && (
              <p className="mt-1.5 text-[10px] text-amber-600 dark:text-amber-400 italic">
                ⓘ {t('portail.intermediatePriceEstimated')}
              </p>
            )}
          </div>
        )}
        {/* Fallback rétrocompat : anciens stops non enrichis (city seulement) */}
        {Array.isArray(trip.stops) && trip.stops.length > 0 && !hasEnrichedStops(trip.stops) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-4 px-1">
            <span className="text-[10px] text-slate-400 font-medium">{t('portail.via')}:</span>
            {trip.stops.map((s, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full [background:color-mix(in_srgb,var(--portal-accent-light),white_50%)] text-amber-700 dark:text-amber-400 font-medium border border-amber-200/50 dark:border-amber-800/30">{(s as { city: string }).city}</span>
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

type BookingStep = 'passengers' | 'seats' | 'payment' | 'confirmation';

interface SeatInfo {
  seatingMode: string;
  seatLayout: SeatLayout | null;
  occupiedSeats: string[];
  availableCount: number;
  totalCount: number;
  seatSelectionFee: number;
  isFullVip?: boolean;
  vipSeats?: string[];
}

interface TicketResult {
  bookingRef: string;
  ticketId: string;
  status: string;
  qrCode: string;
  fareClass: string;
  seatNumber: string | null;
  pricePaid?: number;
  wantsSeatSelection?: boolean;
  passenger: { firstName: string; lastName: string };
  documents: { ticketStubUrl: string | null; invoiceUrl: string | null };
}

interface BookingResult {
  tickets: TicketResult[];
  trip: { departure: string; arrival: string; departureTime: string; arrivalTime: string; routeName: string; price: number };
  totalPrice: number;
  seatSelectionFee?: number;
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
  // CAPTCHA token (Cloudflare Turnstile) — null si pas rendu ou expiré.
  const [bookingCaptcha, setBookingCaptcha] = useState<string | null>(null);

  // ── Seat selection state ──────────────────────────────────────────────────
  const [seatInfo, setSeatInfo] = useState<SeatInfo | null>(null);
  const [seatLoading, setSeatLoading] = useState(false);
  const isNumbered = trip.seatingMode === 'NUMBERED' && !!trip.seatLayout;

  // Steps: skip "seats" step if trip is FREE seating
  const steps: BookingStep[] = isNumbered
    ? ['passengers', 'seats', 'payment', 'confirmation']
    : ['passengers', 'payment', 'confirmation'];
  const ci = steps.indexOf(step);
  const isVip = trip.busType === 'VIP';

  // ── Pricing with seat selection fee ───────────────────────────────────────
  const seatFee = seatInfo?.seatSelectionFee ?? trip.seatSelectionFee ?? 0;
  const seatSelectCount = passengers.filter(p => p.wantsSeatSelection).length;
  const subtotal = trip.price * count + seatFee * seatSelectCount;
  const fee = Math.round(subtotal * 0.03);
  const total = subtotal + fee;

  const updatePassenger = (idx: number, patch: Partial<PassengerInfo>) =>
    setPassengers(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));

  const allPassengersValid = passengers.every(p => p.firstName && p.lastName && p.phone);

  // ── Fetch real-time seat data when entering seats step ────────────────────
  async function loadSeats() {
    if (!apiBase) return;
    setSeatLoading(true);
    try {
      const data = await apiFetch<SeatInfo>(`${apiBase}/trips/${trip.id}/seats`, {
        skipRedirectOn401: true,
      });
      setSeatInfo(data);
    } catch {
      // Fallback: use trip-level data
      setSeatInfo(null);
    } finally {
      setSeatLoading(false);
    }
  }

  function goToSeatsOrPayment() {
    if (isNumbered) {
      loadSeats();
      setStep('seats');
    } else {
      setStep('payment');
    }
  }

  // All occupied seats = backend occupied + locally selected by other passengers
  const occupiedForPicker = (idx: number) => {
    const backend = seatInfo?.occupiedSeats ?? [];
    const otherPax = passengers
      .filter((p, i) => i !== idx && p.wantsSeatSelection && p.seatNumber)
      .map(p => p.seatNumber!);
    return [...backend, ...otherPax];
  };

  async function handlePay() {
    if (!apiBase || !selectedPayment) return;
    setBookingLoading(true);
    setBookingError(null);
    try {
      const result = await apiFetch<BookingResult>(`${apiBase}/booking`, {
        method: 'POST',
        skipRedirectOn401: true,
        captchaToken:   bookingCaptcha,
        idempotencyKey: newIdempotencyKey(),
        body: {
          tripId: trip.id,
          passengers: passengers.map(p => ({
            firstName:          p.firstName ?? '',
            lastName:           p.lastName ?? '',
            phone:              p.phone ?? '',
            email:              p.email,
            seatType:           p.seatType ?? 'STANDARD',
            wantsSeatSelection: p.wantsSeatSelection || undefined,
            seatNumber:         p.wantsSeatSelection ? p.seatNumber : undefined,
          })),
          paymentMethod: selectedPayment,
          // Segments intermédiaires (Sprint 1/2) — si absents, backend utilisera OD complet par défaut
          boardingStationId:  trip.boardingStationId,
          alightingStationId: trip.alightingStationId,
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
                {s === 'passengers' ? t('portail.passengers') : s === 'seats' ? t('portail.seatSelection') : s === 'payment' ? t('portail.payment') : t('portail.confirmation')}
              </span>
              {i < steps.length - 1 && <div className={cn('flex-1 h-0.5 rounded-full mx-2', ci > i ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700')} />}
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
                    {/* TODO S2: consommer l'endpoint public `/p/:slug/fare-classes`
                        (à créer) pour que le portail voyageur reflète les
                        TenantFareClass configurées par le tenant. Pour S1, on
                        reste sur STANDARD/VIP qui sont seedés par défaut pour
                        tous les tenants et couvrent 99% des cas. */}
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
          {step === 'seats' && isNumbered && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white text-base sm:text-lg">{t('portail.seatSelection')}</h3>
                <p className="text-sm text-slate-500 mt-1">{t('portail.seatSelectionDesc')}</p>
              </div>
              {seatLoading && (
                <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
                  <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75"/></svg>
                  <span className="text-sm">{t('portail.loadingSeats')}</span>
                </div>
              )}
              {!seatLoading && seatInfo?.seatLayout && (
                <div className="space-y-6">
                  {passengers.map((pax, idx) => (
                    <div key={idx} className={cn('space-y-4', count > 1 && 'bg-slate-50 dark:bg-slate-800/30 rounded-2xl p-4 sm:p-5 border border-slate-100 dark:border-slate-700/50')}>
                      {count > 1 && <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('portail.passengerN').replace('{n}', String(idx + 1))} — {pax.firstName} {pax.lastName}</p>}
                      <label className={cn('flex items-center gap-3 p-3 sm:p-4 rounded-2xl border-2 cursor-pointer transition-all',
                        pax.wantsSeatSelection ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-900/20' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300')}>
                        <input type="checkbox" checked={!!pax.wantsSeatSelection}
                          onChange={e => updatePassenger(idx, {
                            wantsSeatSelection: e.target.checked,
                            seatNumber: e.target.checked ? pax.seatNumber : null,
                          })}
                          className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
                        <div className="flex-1">
                          <span className="text-sm font-semibold text-slate-800 dark:text-white">{t('portail.chooseMySeat')}</span>
                          {seatFee > 0 && <span className="text-xs text-amber-600 dark:text-amber-400 ml-2">+{fmt(seatFee)}</span>}
                        </div>
                      </label>
                      {pax.wantsSeatSelection && (
                        <SeatMapPicker
                          seatLayout={seatInfo.seatLayout!}
                          occupiedSeats={occupiedForPicker(idx)}
                          selectedSeat={pax.seatNumber ?? null}
                          onSelect={seatId => updatePassenger(idx, { seatNumber: pax.seatNumber === seatId ? null : seatId })}
                          seatSelectionFee={seatFee}
                          currency={undefined}
                          isFullVip={seatInfo.isFullVip ?? trip.isFullVip}
                          vipSeats={seatInfo.vipSeats ?? trip.vipSeats}
                        />
                      )}
                      {!pax.wantsSeatSelection && (
                        <p className="text-xs text-slate-400 italic">{t('portail.autoAssignSeat')}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {step === 'payment' && (
            <div className="space-y-5">
              <div><h3 className="font-semibold text-slate-900 dark:text-white text-base sm:text-lg">{t('portail.payment')}</h3><p className="text-sm text-slate-500 mt-1">{t('portail.selectPayment')}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 sm:p-5 space-y-3 border border-slate-100 dark:border-slate-700/50">
                <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">{t('portail.ticket')} {trip.departure} &rarr; {trip.arrival} &times; {count}</span><span className="font-semibold text-slate-900 dark:text-white">{fmt(trip.price * count)}</span></div>
                {seatSelectCount > 0 && seatFee > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-slate-600 dark:text-slate-400">{t('portail.seatSelectionFeeLabel')} &times; {seatSelectCount}</span><span className="font-semibold text-amber-600 dark:text-amber-400">{fmt(seatFee * seatSelectCount)}</span></div>
                )}
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
                    {tk.wantsSeatSelection && booking.seatSelectionFee && booking.seatSelectionFee > 0 && (
                      <IRow l={t('portail.seatSelectionFeeLabel')} v={fmt(booking.seatSelectionFee)} />
                    )}
                    <IRow l={t('portail.total')} v={fmt(tk.pricePaid ?? booking.trip.price)} hl />
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
          {step === 'passengers' && (
            <button onClick={goToSeatsOrPayment} disabled={!allPassengersValid}
              className={cn('w-full py-3 sm:py-3.5 rounded-xl font-semibold text-sm transition-all',
                allPassengersValid ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed')}>
              {isNumbered ? t('portail.continueToSeats') : t('portail.continueToPayment')}
            </button>
          )}
          {step === 'seats' && (
            <div className="flex gap-3">
              <button onClick={() => setStep('passengers')} className="flex-1 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-50">{t('portail.back')}</button>
              <button onClick={() => setStep('payment')}
                disabled={passengers.some(p => p.wantsSeatSelection && !p.seatNumber)}
                className={cn('flex-1 py-3 rounded-xl font-semibold text-sm transition-all',
                  passengers.every(p => !p.wantsSeatSelection || p.seatNumber)
                    ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed')}>
                {t('portail.continueToPayment')}
              </button>
            </div>
          )}
          {step === 'payment' && (
            <div className="space-y-3">
              {bookingError && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">{bookingError}</div>
              )}
              {/* CAPTCHA Cloudflare Turnstile — rendu silencieux si pas de site-key */}
              <CaptchaWidget onToken={setBookingCaptcha} />
              <div className="flex gap-3">
                <button onClick={() => setStep(isNumbered ? 'seats' : 'passengers')} disabled={bookingLoading} className="flex-1 py-3 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl font-semibold text-sm hover:bg-slate-50">{t('portail.back')}</button>
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
function Sel({ label, value, set, options, placeholder, ariaLabel }: { label: string; value: string; set: (v: string) => void; options: { value: string; label: string }[]; placeholder: string; ariaLabel?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">{label}</label>
      <select
        value={value}
        onChange={e => set(e.target.value)}
        aria-label={ariaLabel ?? label}
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-900 dark:text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)] focus:border-amber-500 transition-all"
      >
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
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

  // All stations with valid numeric coordinates
  const geoStations = stations.filter(s =>
    s.coordinates != null &&
    typeof s.coordinates.lat === 'number' && isFinite(s.coordinates.lat) &&
    typeof s.coordinates.lng === 'number' && isFinite(s.coordinates.lng),
  );

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

interface ParcelTrackResult {
  trackingCode: string;
  status:       string;
  fromCity:     string | null;
  toCity:       string | null;
  createdAt:    string;
}

interface ParcelPickupResult {
  trackingCode:      string;
  status:            string;
  destination:       { name: string; city: string };
  labelUrl:          string | null;
  documentsWarning?: string | null;
}

const PARCEL_STATUS_LABEL: Record<string, string> = {
  CREATED:    'portail.parcelStatusCreated',
  AT_ORIGIN:  'portail.parcelStatusAtOrigin',
  PACKED:     'portail.parcelStatusPacked',
  LOADED:     'portail.parcelStatusLoaded',
  IN_TRANSIT: 'portail.inTransit',
  ARRIVED:    'portail.parcelStatusArrived',
  DELIVERED:  'portail.parcelStatusDelivered',
  DAMAGED:    'portail.parcelStatusDamaged',
  LOST:       'portail.parcelStatusLost',
  RETURNED:   'portail.parcelStatusReturned',
};

function ParcelSection({ t, apiBase }: { t: (k: string) => string; apiBase: string | null }) {
  const [tab, setTab] = useState<'track' | 'send'>('track');
  const { cities } = useTenantConfig();
  const cityOptions = useMemo(
    () => cities.map(c => ({ value: c.name, label: c.name })),
    [cities],
  );

  // ── Track state ────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [trackResult, setTrackResult] = useState<ParcelTrackResult | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  async function handleTrack(e: FormEvent) {
    e.preventDefault();
    if (!apiBase || !code.trim()) return;
    setTrackLoading(true);
    setTrackError(null);
    setTrackResult(null);
    try {
      const result = await apiFetch<ParcelTrackResult>(
        `${apiBase}/parcels/${encodeURIComponent(code.trim())}/track`,
        { skipRedirectOn401: true },
      );
      setTrackResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('portail.parcelNotFound');
      setTrackError(msg || t('portail.parcelNotFound'));
    } finally {
      setTrackLoading(false);
    }
  }

  // ── Send state ─────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    senderName: '', senderPhone: '',
    recipientName: '', recipientPhone: '',
    fromCity: '', toCity: '',
    description: '',
    weightKg: '',
  });
  const setField = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));
  const [sendLoading, setSendLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ParcelPickupResult | null>(null);
  const [copied, setCopied] = useState(false);
  // Token CAPTCHA Cloudflare Turnstile — null tant que non complété côté widget.
  // Backend fail-open si `tenantBusinessConfig.captchaEnabled = false` OU si
  // Vault `platform/captcha/turnstile` pas provisionné (dev local).
  const [parcelCaptcha, setParcelCaptcha] = useState<string | null>(null);

  const formValid =
    form.senderName.trim().length >= 2 &&
    form.senderPhone.trim().length >= 6 &&
    form.recipientName.trim().length >= 2 &&
    form.recipientPhone.trim().length >= 6 &&
    form.fromCity.trim().length >= 2 &&
    form.toCity.trim().length >= 2 &&
    form.description.trim().length >= 3;

  async function handleSend() {
    if (!apiBase || !formValid) return;
    setSendLoading(true);
    setSendError(null);
    try {
      const weightKg = form.weightKg.trim() ? Number(form.weightKg.replace(',', '.')) : undefined;
      const result = await apiFetch<ParcelPickupResult>(`${apiBase}/parcel-pickup-request`, {
        method: 'POST',
        skipRedirectOn401: true,
        captchaToken:   parcelCaptcha,
        idempotencyKey: newIdempotencyKey(),
        body: {
          senderName:    form.senderName.trim(),
          senderPhone:   form.senderPhone.trim(),
          recipientName: form.recipientName.trim(),
          recipientPhone: form.recipientPhone.trim(),
          fromCity:      form.fromCity.trim(),
          toCity:        form.toCity.trim(),
          description:   form.description.trim(),
          ...(weightKg !== undefined && !isNaN(weightKg) ? { weightKg } : {}),
        },
      });
      setSendResult(result);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t('portail.parcelPickupError'));
    } finally {
      setSendLoading(false);
    }
  }

  function resetSend() {
    setForm({
      senderName: '', senderPhone: '',
      recipientName: '', recipientPhone: '',
      fromCity: '', toCity: '',
      description: '', weightKg: '',
    });
    setSendResult(null);
    setSendError(null);
    setCopied(false);
  }

  async function copyCode(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — ignore */ }
  }

  const statusKey = trackResult ? PARCEL_STATUS_LABEL[trackResult.status] : null;
  const statusLabel = statusKey ? t(statusKey) : trackResult?.status ?? '';

  return (
    <div>
      <div className="flex items-center gap-3 mb-6"><div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" /><h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.parcelTitle')}</h2></div>
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-xl p-1 mb-6 max-w-xs">
        {(['track', 'send'] as const).map(tb => (
          <button
            key={tb}
            onClick={() => { setTab(tb); setTrackError(null); setTrackResult(null); }}
            className={cn('flex-1 py-2 rounded-lg text-sm font-semibold transition-all',
              tab === tb ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            {tb === 'track' ? t('portail.trackParcel') : t('portail.sendParcel')}
          </button>
        ))}
      </div>

      {tab === 'track' && (
        <div className="max-w-lg">
          <form onSubmit={handleTrack} className="flex flex-col sm:flex-row gap-3">
            <input
              placeholder={t('portail.trackingPlaceholder')}
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={trackLoading}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!code.trim() || trackLoading || !apiBase}
              className="px-6 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {trackLoading ? t('portail.tracking') : t('portail.track')}
            </button>
          </form>

          {trackError && (
            <div className="mt-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
              {trackError}
            </div>
          )}

          {trackResult && (
            <div className="mt-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl [background:var(--portal-accent-light)] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 0 0-8 0v2"/></svg>
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white text-sm">{trackResult.trackingCode}</p>
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-[10px] font-bold uppercase">{statusLabel}</span>
                </div>
              </div>
              <div className="space-y-2">
                {trackResult.fromCity && <IRow l={t('portail.departure')} v={trackResult.fromCity} />}
                {trackResult.toCity && <IRow l={t('portail.arrival')} v={trackResult.toCity} />}
                <IRow l={t('portail.dateLabel')} v={fmtDate(trackResult.createdAt)} />
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'send' && !sendResult && (
        <div className="max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <p className="text-sm text-slate-500 mb-4">{t('portail.sendParcelDesc')}</p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Inp label={t('portail.senderName')} ph="Jean Makaya" value={form.senderName} set={setField('senderName')} />
              <Inp label={t('portail.senderPhone')} ph="+242 06 000 00 00" value={form.senderPhone} set={setField('senderPhone')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Inp label={t('portail.recipientName')} ph="Marie Mouanda" value={form.recipientName} set={setField('recipientName')} />
              <Inp label={t('portail.recipientPhone')} ph="+242 05 000 00 00" value={form.recipientPhone} set={setField('recipientPhone')} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Sel label={t('portail.fromCity')} value={form.fromCity} set={setField('fromCity')} options={cityOptions} placeholder={t('portail.searchCityPlaceholder')} />
              <Sel label={t('portail.toCity')}   value={form.toCity}   set={setField('toCity')}   options={cityOptions} placeholder={t('portail.searchCityPlaceholder')} />
            </div>
            <Inp label={t('portail.parcelDescription')} ph={t('portail.parcelDescPlaceholder')} value={form.description} set={setField('description')} />
            <Inp label={t('portail.parcelWeightKg')} ph={t('portail.parcelWeightPlaceholder')} value={form.weightKg} set={setField('weightKg')} />

            {sendError && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300" role="alert">
                {sendError}
              </div>
            )}

            {/* Turnstile CAPTCHA — rendu seulement si VITE_TURNSTILE_SITE_KEY présent.
                Sinon silencieux (backend fail-open si tenant.captchaEnabled=false). */}
            <CaptchaWidget onToken={setParcelCaptcha} />

            <button
              onClick={handleSend}
              disabled={!formValid || sendLoading || !apiBase}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-sm hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sendLoading ? t('portail.sending') : t('portail.requestPickup')}
            </button>
          </div>
        </div>
      )}

      {tab === 'send' && sendResult && (
        <div className="max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">{t('portail.parcelPickupSuccess')}</h3>
              <p className="text-xs text-slate-500">{t('portail.parcelPickupSuccessMsg')}</p>
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 mb-4">
            <p className="text-xs uppercase tracking-wide font-semibold text-slate-500 mb-1">{t('portail.trackingCodeLabel')}</p>
            <div className="flex items-center gap-2">
              <p className="text-lg sm:text-xl font-mono font-black tracking-widest text-slate-900 dark:text-white flex-1">{sendResult.trackingCode}</p>
              <button
                onClick={() => copyCode(sendResult.trackingCode)}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-600 transition-all"
              >
                {copied ? t('portail.codeCopied') : t('portail.copyCode')}
              </button>
            </div>
          </div>
          <div className="space-y-2 mb-4">
            <IRow l={t('portail.arrival')} v={`${sendResult.destination.city || sendResult.destination.name}`} />
          </div>

          {sendResult.labelUrl && (
            <a
              href={sendResult.labelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full mb-3 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-sm hover:from-amber-600 hover:to-amber-700 shadow-lg shadow-amber-500/20 transition-all"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {t('portail.downloadParcelReceipt')}
            </a>
          )}
          {sendResult.documentsWarning && !sendResult.labelUrl && (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 mb-3">
              {sendResult.documentsWarning}
            </p>
          )}

          <button
            onClick={resetSend}
            className="w-full py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
          >
            {t('portail.newRequest')}
          </button>
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
  amenities: string[];
}

function FleetSection({ t, apiBase }: { t: (k: string) => string; apiBase: string | null }) {
  const fleetRes = useFetch<FleetBus[]>(apiBase ? `${apiBase}/fleet` : null, [apiBase], { skipRedirectOn401: true });
  const fleet = fleetRes.data ?? [];
  const [selectedBus, setSelectedBus] = useState<FleetBus | null>(null);
  const rows = (bus: FleetBus) => Math.ceil(bus.capacity / 4);

  const currentYear = new Date().getFullYear();
  const busesWithYear = fleet.filter(b => b.year != null);
  const avgAge = busesWithYear.length > 0
    ? Math.round(busesWithYear.reduce((s, b) => s + (currentYear - b.year!), 0) / busesWithYear.length)
    : 0;
  const typeCount = (type: string | null) => fleet.filter(b => b.type === type).length;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4"><div className="w-1 h-6 bg-[image:linear-gradient(to_bottom,var(--portal-accent),var(--portal-accent-dark))] rounded-full" /><h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">{t('portail.fleetTitle')}</h2></div>

      {/* Fleet stats banner */}
      {fleet.length > 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
          {t('portail.fleetStats').replace('{count}', String(fleet.length)).replace('{age}', String(avgAge))}
        </p>
      )}

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
                <p className="text-xs text-slate-500 mt-1">
                  {bus.capacity} {t('portail.seats')}{bus.year ? ` \u00b7 ${bus.year}` : ''}{bus.type ? ` \u00b7 ${bus.type}` : ''}
                </p>
                {/* Amenities badges on card */}
                {(bus.amenities ?? []).length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mt-2.5">
                    {(bus.amenities ?? []).slice(0, 4).map(a => (
                      <span key={a} className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                        {tAmenity(t, a)}
                      </span>
                    ))}
                    {(bus.amenities ?? []).length > 4 && (
                      <span className="text-[10px] text-slate-400">+{(bus.amenities ?? []).length - 4}</span>
                    )}
                  </div>
                )}
                <p className="text-xs font-semibold mt-3" style={{ color: 'var(--portal-accent)' }}>{t('portail.fleetViewDetails')} &rarr;</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Bus detail modal — responsive: 2-col on lg, stacked on mobile */}
      {selectedBus && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center p-0 sm:p-4 lg:p-8">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md" onClick={() => setSelectedBus(null)} />
          <div className="relative z-10 w-full max-w-4xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl lg:rounded-3xl shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto border border-slate-200/50 dark:border-slate-700/50">
            {/* Close button — always visible */}
            <button
              onClick={() => setSelectedBus(null)}
              className="absolute top-4 right-4 z-20 p-2 rounded-full bg-black/40 hover:bg-black/60 text-white transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>

            {/* Desktop: 2-column layout / Mobile: stacked */}
            <div className="lg:grid lg:grid-cols-5">

              {/* Left column — photo + infos (3/5 on desktop) */}
              <div className="lg:col-span-3 lg:border-r border-slate-200 dark:border-slate-700/50">
                {/* Photo */}
                {selectedBus.photos.length > 0 ? (
                  <div className="h-52 sm:h-64 lg:h-72 relative overflow-hidden rounded-t-3xl sm:rounded-t-2xl lg:rounded-tl-3xl lg:rounded-tr-none">
                    <img src={selectedBus.photos[0]} alt={selectedBus.model} className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    {selectedBus.photos.length > 1 && (
                      <span className="absolute bottom-3 right-3 text-[11px] bg-black/50 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">{selectedBus.photos.length} photos</span>
                    )}
                  </div>
                ) : (
                  <div className="h-40 lg:h-52 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center rounded-t-3xl sm:rounded-t-2xl lg:rounded-tl-3xl lg:rounded-tr-none">
                    <svg className="w-32 h-20 opacity-20" viewBox="0 0 200 80" fill="none">
                      <rect x="10" y="20" width="180" height="45" rx="8" fill="currentColor" className="text-slate-400" />
                      <rect x="20" y="10" width="140" height="20" rx="5" fill="currentColor" className="text-slate-300" />
                      <circle cx="50" cy="70" r="10" fill="currentColor" className="text-slate-500" />
                      <circle cx="150" cy="70" r="10" fill="currentColor" className="text-slate-500" />
                    </svg>
                  </div>
                )}

                {/* Bus info */}
                <div className="p-5 sm:p-6 lg:p-8 space-y-5">
                  {/* Title + type badge */}
                  <div>
                    <h3 className="text-xl lg:text-2xl font-bold text-slate-900 dark:text-white">{selectedBus.model}</h3>
                    <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                      {selectedBus.type && (
                        <span className={cn('px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider',
                          selectedBus.type === 'VIP' ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        )}>{selectedBus.type}</span>
                      )}
                      <span className="text-sm text-slate-500">{selectedBus.capacity} {t('portail.seats')}</span>
                      {selectedBus.year && <span className="text-sm text-slate-400">&middot; {selectedBus.year}</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      {t('portail.fleetTypeCount').replace('{count}', String(typeCount(selectedBus.type)))}
                    </p>
                  </div>

                  {/* Amenities */}
                  {(selectedBus.amenities ?? []).length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('portail.fleetAmenities')}</p>
                      <div className="flex gap-2 flex-wrap">
                        {(selectedBus.amenities ?? []).map(a => (
                          <span key={a} className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">
                            {tAmenity(t, a)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right column — seatmap (2/5 on desktop, full width on mobile) */}
              <div className="lg:col-span-2 p-5 sm:p-6 lg:p-8 border-t lg:border-t-0 border-slate-200 dark:border-slate-700/50">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 lg:p-6 border border-slate-200 dark:border-slate-700/50 h-full">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">{t('portail.seatmapTitle')}</p>
                  {/* Driver area */}
                  <div className="flex justify-center mb-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-300 dark:bg-slate-600 flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 dark:text-slate-400"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>
                    </div>
                  </div>
                  {/* Seat grid */}
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
                                <span key={col} className="contents">{col === aisle && <span className="w-4 inline-block" />}
                                <span className={cn(
                                  'w-7 h-7 lg:w-8 lg:h-8 rounded inline-flex items-center justify-center text-[9px] lg:text-[10px] font-bold',
                                  isDis ? 'bg-slate-200 dark:bg-slate-700 text-slate-400' : 'bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300/50 text-emerald-700 dark:text-emerald-400'
                                )}>{isDis ? '\u00d7' : seatNum}</span></span>
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
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

type Section = 'booking' | 'parcels' | 'nearby' | 'about' | 'fleet' | 'contact' | 'news' | 'news-detail';

interface NewsPost {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  content?: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  authorName: string | null;
  tags: string[];
  media?: Array<{ url: string; type: string; caption?: string; signedUrl?: string | null }>;
}

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
  // Phase 1 multi-tenant : le slug peut venir
  //   (a) du path legacy `/p/:tenantSlug/*` (redirigé vers le sous-domaine
  //       par LegacyTenantRedirect → cette branche ne tourne plus longtemps)
  //   (b) du sous-domaine `{slug}.translogpro.com` (nouveau routing)
  const params = useParams<{ tenantSlug: string }>();
  const tenantSlug = params.tenantSlug ?? resolveHost().slug ?? undefined;
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

  // Annonces actives (polling public — le portail est anonyme par défaut)
  const { announcements: portalAnnouncements } = useAnnouncements({
    mode:       'public',
    tenantSlug: tenantSlug ?? undefined,
    enabled:    !!tenantSlug,
  });
  const skip = useMemo(() => ({ skipRedirectOn401: true } as const), []);
  const cfgUrl = apiBase ? `${apiBase}/config` : null;
  const stUrl = apiBase ? `${apiBase}/stations` : null;
  const cfgDeps = useMemo(() => [tenantSlug], [tenantSlug]);
  const cfg = useFetch<{ tenant: { name: string; contact: Record<string, string>; city?: string; country?: string }; brand: { brandName: string; logoUrl?: string }; paymentMethods: PaymentMethod[]; portal?: { themeId?: string; newsCmsEnabled?: boolean } | null }>(cfgUrl, cfgDeps, skip);
  const stRes = useFetch<StationInfo[]>(stUrl, cfgDeps, skip);
  // Tenant name takes priority — brand.brandName is only used if tenant specifically set it
  const brandName = cfg.data?.tenant?.name || cfg.data?.brand?.brandName || '';
  const brandLogo = cfg.data?.brand?.logoUrl;
  const stations = stRes.data ?? [];
  const pms = cfg.data?.paymentMethods ?? DEMO_PAYMENT_METHODS; // payment methods fallback OK (country-specific)

  // Villes uniquement — le backend matche toutes les gares d'une ville via stopMatches(city).
  const cityOptions: ComboboxOption[] = useMemo(() => {
    const opts = new Map<string, { label: string; importance: number }>();
    for (const s of stations) {
      if (!s.city) continue;
      const key = s.city.toLowerCase();
      const importance = s.type === 'PRINCIPALE' ? 40 : 20;
      const prev = opts.get(key);
      if (!prev || prev.importance < importance) opts.set(key, { label: s.city, importance });
    }
    return [...opts.entries()]
      .sort((a, b) => b[1].importance - a[1].importance || a[1].label.localeCompare(b[1].label))
      .map(([, meta]) => ({ value: meta.label, label: meta.label }));
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

  // ── CMS pages (hero, about, contact) ──
  const pagesUrl = apiBase ? `${apiBase}/pages?locale=${lang}` : null;
  const pagesDeps = useMemo(() => [tenantSlug, lang], [tenantSlug, lang]);
  const pagesRes = useFetch<CmsPage[]>(pagesUrl, pagesDeps, skip);
  const cmsPages = pagesRes.data ?? [];
  const heroCms   = useMemo(() => parseCmsJson<HeroCms>(cmsPages.find(p => p.slug === 'hero')),     [cmsPages]);
  const aboutCms  = useMemo(() => parseCmsJson<AboutCms>(cmsPages.find(p => p.slug === 'about')),   [cmsPages]);
  const contactCms = useMemo(() => parseCmsJson<ContactCms>(cmsPages.find(p => p.slug === 'contact')), [cmsPages]);

  // ── News / Actualités (CMS) ──
  const newsCmsEnabled = cfg.data?.portal?.newsCmsEnabled ?? false;
  const newsUrl = apiBase && newsCmsEnabled ? `${apiBase}/posts` : null;
  const newsRes = useFetch<NewsPost[]>(newsUrl, [tenantSlug, newsCmsEnabled], skip);
  const [selectedPost, setSelectedPost] = useState<NewsPost | null>(null);

  const openNewsDetail = useCallback(async (post: NewsPost) => {
    if (!apiBase || !post.slug) return;
    try {
      const detail = await apiFetch<NewsPost>(`${apiBase}/posts/${post.slug}`, { skipRedirectOn401: true });
      setSelectedPost(detail);
      setSection('news-detail');
    } catch {
      setSelectedPost(post);
      setSection('news-detail');
    }
  }, [apiBase]);

  const initDone = useRef(false);

  // Set default cities ONCE when stations load — pick the two most
  // popular cities (most stations), or leave empty if no clear winner.
  useEffect(() => {
    if (!initDone.current && cityOptions.length >= 2) {
      setDep(cityOptions[0].value);
      // Pick first city that differs from dep for arrival
      const arrOption = cityOptions.find(o => o.value !== cityOptions[0].value);
      if (arrOption) setArr(arrOption.value);
      initDone.current = true;
    }
  }, [cityOptions]);

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

  // ── Auth : bouton navbar contextuel ─────────────────────────────────────
  //   - anonyme          → "Connexion" → /login (avec from = page courante)
  //   - CUSTOMER connecté → "Mon compte" → /customer
  //   - autre userType connecté (admin, driver…) → HomeRedirect à /
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const authLabel = user
    ? (user.userType === 'CUSTOMER' ? t('portail.myAccount') : t('portail.dashboard'))
    : t('portail.login');
  const handleAuthClick = useCallback(() => {
    if (!user) {
      navigate('/login', { state: { from: location } });
      return;
    }
    if (user.userType === 'CUSTOMER') {
      navigate('/customer');
      return;
    }
    // Autres profils : laisser HomeRedirect router vers leur portail.
    navigate('/');
  }, [user, navigate, location]);

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
      {/* ── Bandeau annonces (temps réel, polling public) ──────────── */}
      {portalAnnouncements.length > 0 && (
        <AnnouncementTicker
          announcements={portalAnnouncements}
          lang={lang}
          className="sticky top-0 z-50"
        />
      )}

      {/* ── Navbar (layout-variant) ────────────────────────────── */}
      {layout === 'horizon' ? (
        <HorizonNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={authLabel} onLogin={handleAuthClick} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'vivid' ? (
        <VividNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={authLabel} onLogin={handleAuthClick} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
      ) : layout === 'prestige' ? (
        <PrestigeNavbar brandName={brandName} brandLogo={brandLogo} nav={navItems} section={section} onSection={handleSection} onHome={handleHome} mobileNav={mobileNav} setMobileNav={setMobileNav} themeToggle={<ThemeToggle />} langSwitcher={<LanguageSwitcher />} loginLabel={authLabel} onLogin={handleAuthClick} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />
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
              <button
                type="button"
                onClick={handleAuthClick}
                className="hidden sm:block text-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-xl font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm ml-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white"
              >{authLabel}</button>
              <button onClick={() => setMobileNav(v => !v)} className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ml-1" aria-label={mobileNav ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={mobileNav}>
                {mobileNav ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>}
              </button>
            </div>
          </div>
          {mobileNav && (
            <div className="md:hidden border-t border-slate-200/50 dark:border-slate-800/50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-xl animate-in slide-in-from-top-2 duration-150">
              <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
                {NAV.map(n => <button key={n.key} onClick={() => { handleSection(n.key); setMobileNav(false); }} className={cn('w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-colors', section === n.key ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50')}>{n.label}</button>)}
                <button
                  type="button"
                  onClick={() => { setMobileNav(false); handleAuthClick(); }}
                  className="sm:hidden w-full mt-2 text-sm bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2.5 rounded-xl font-semibold hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900 dark:focus-visible:ring-white"
                >{authLabel}</button>
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
        const heroStats = (heroCms?.stats ?? []).filter(s => s.value.trim() !== '');
        const hTitle    = heroCms?.title     || t('portail.heroTitle');
        const hSubtitle = heroCms?.subtitle  || t('portail.heroSubtitle');
        const hTrusted  = heroCms?.trustedBy || t('portail.trustedBy');

        if (layout === 'horizon') return <HorizonHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={hTitle} subtitle={hSubtitle} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;
        if (layout === 'vivid') return <VividHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={hTitle} subtitle={hSubtitle} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;
        if (layout === 'prestige') return <PrestigeHero scenes={portalTheme.heroScenes} searchForm={searchFormEl} title={hTitle} subtitle={hSubtitle} stats={heroStats} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} />;

        // Classic hero (original)
        return (
          <HeroCarousel>
            <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-16 sm:pb-20">
              <div className="flex items-center gap-2 mb-4 sm:mb-6">{[1,2,3,4,5].map(i => <span key={i} className="text-amber-400 text-sm">{'\u2605'}</span>)}<span className="text-sm text-slate-400 font-medium">{hTrusted}</span></div>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.1] tracking-tight max-w-2xl">{hTitle}</h1>
              <p className="text-base sm:text-xl text-slate-400 mt-3 sm:mt-4 max-w-xl leading-relaxed">{hSubtitle}</p>
              <div className="mt-8 sm:mt-10 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl shadow-black/20 border border-white/5">{searchFormEl}</div>
              {heroStats.length > 0 && (
                <div className="flex items-center justify-center gap-6 sm:gap-12 mt-8 sm:mt-10 text-center">
                  {heroStats.map(s => <div key={s.label}><p className="text-xl sm:text-3xl font-black text-white">{s.value}</p><p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 font-medium uppercase tracking-wider">{s.label}</p></div>)}
                </div>
              )}
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
              <div className="flex flex-col gap-4 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3"><button onClick={() => setSearched(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button><h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">{dep} &rarr; {arr}</h2></div>
                    <p className="text-sm text-slate-500 mt-1 ml-10">{sorted.filter(r => r.canBook).length} {t('portail.tripsAvailable')}</p>
                  </div>
                  <select value={sort} onChange={e => setSort(e.target.value as any)} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]"><option value="time">{t('portail.sortDeparture')}</option><option value="price">{t('portail.sortPrice')}</option></select>
                </div>
                {/* ── Inline modifiers: date + passengers ── */}
                <div className="flex flex-wrap items-center gap-3 ml-10">
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-400 shrink-0"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <input
                      type="date" value={date}
                      onChange={e => { setDate(e.target.value); setLoading(true); apiFetch<TripResult[]>(`${apiBase}/trips/search?${new URLSearchParams({ departure: dep, arrival: arr, date: e.target.value, passengers: String(pax) })}`, { method: 'GET', skipRedirectOn401: true }).then(r => setResults(r)).catch(() => setResults([])).finally(() => setLoading(false)); }}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-400 shrink-0"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
                    <select
                      value={pax}
                      onChange={e => { const n = Number(e.target.value); setPax(n); setLoading(true); apiFetch<TripResult[]>(`${apiBase}/trips/search?${new URLSearchParams({ departure: dep, arrival: arr, date, passengers: String(n) })}`, { method: 'GET', skipRedirectOn401: true }).then(r => setResults(r)).catch(() => setResults([])).finally(() => setLoading(false)); }}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 text-slate-700 dark:text-slate-300 font-medium focus:outline-none focus:ring-2 focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--portal-accent),transparent_50%)]"
                    >
                      {[1,2,3,4,5,6,7,8].map(n => (
                        <option key={n} value={n}>{n} {n === 1 ? t('portail.passenger') : t('portail.passengers')}</option>
                      ))}
                    </select>
                  </div>
                </div>
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
        {section === 'parcels' && <ParcelSection t={t} apiBase={apiBase} />}
        {section === 'nearby' && <NearbyStations stations={stations} t={t} />}
        {section === 'about' && (() => {
          const ICON_MAP: Record<string, string> = { shield: '\u2691', sparkles: '\u2726', target: '\u2316' };
          const fallbackFeatures = [
            { i: '\u2691', t: t('portail.aboutSafety'), d: t('portail.aboutSafetyDesc') },
            { i: '\u2726', t: t('portail.aboutComfort'), d: t('portail.aboutComfortDesc') },
            { i: '\u2316', t: t('portail.aboutReliability'), d: t('portail.aboutReliabilityDesc') },
          ];
          const features = aboutCms?.features
            ? aboutCms.features.map(f => ({ i: ICON_MAP[f.icon] || '\u2726', t: f.title, d: f.description }))
            : fallbackFeatures;
          return (
          <div className="max-w-3xl mx-auto"><STitle title={t('portail.aboutTitle')} />
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-3xl p-6 sm:p-10 border border-slate-200 dark:border-slate-700/50"><p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 leading-relaxed">{aboutCms?.description || t('portail.aboutContent')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-8">{features.map(v => <div key={v.t} className="text-center p-4"><span className="text-3xl block mb-3">{v.i}</span><h4 className="font-bold text-slate-900 dark:text-white text-sm">{v.t}</h4><p className="text-xs text-slate-500 mt-1">{v.d}</p></div>)}</div></div></div>);
        })()}
        {section === 'fleet' && <FleetSection t={t} apiBase={apiBase} />}
        {section === 'contact' && (
          <div className="max-w-2xl mx-auto"><STitle title={t('portail.contactTitle')} />
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-700/50">
              {(() => {
                const addressVal = cfg.data?.tenant?.contact?.address
                  || [cfg.data?.tenant?.city, cfg.data?.tenant?.country].filter(Boolean).join(', ');
                const items = [
                  { i: '\u2706', l: t('portail.phoneLabel'),   v: cfg.data?.tenant?.contact?.phone || '' },
                  { i: '@',      l: t('portail.emailLabel'),    v: cfg.data?.tenant?.contact?.email || '' },
                  { i: '\u2302', l: t('portail.addressLabel'), v: addressVal || '' },
                  { i: '\u231A', l: t('portail.hoursLabel'),   v: contactCms?.hours || '' },
                ].filter(c => c.v.trim() !== '');
                if (items.length === 0) return (
                  <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">{t('portail.contactNotConfigured')}</p>
                );
                return <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">{items.map(c => (
                  <div key={c.l} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl [background:var(--portal-accent-light)] flex items-center justify-center text-amber-600 font-bold shrink-0">{c.i}</div>
                    <div><p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{c.l}</p><p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{c.v}</p></div>
                  </div>
                ))}</div>;
              })()}</div></div>
        )}

        {/* ── Actualités (news list) — footer-only section ────── */}
        {section === 'news' && newsCmsEnabled && (
          <div className="max-w-4xl mx-auto">
            <STitle title={t('portail.newsTitle')} />
            {newsRes.loading ? (
              <div className="flex justify-center py-16"><div className="w-10 h-10 border-[3px] border-slate-200 dark:border-slate-700 border-t-amber-500 rounded-full animate-spin" /></div>
            ) : (newsRes.data ?? []).length === 0 ? (
              <div className="text-center py-16"><p className="text-lg font-semibold text-slate-400">{t('portail.noNews')}</p></div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {(newsRes.data ?? []).map(post => (
                  <button key={post.id} onClick={() => openNewsDetail(post)} className="group text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-black/30 transition-all hover:-translate-y-0.5">
                    {post.coverImageUrl ? (
                      <div className="aspect-video overflow-hidden">
                        <img src={post.coverImageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-slate-300 dark:text-slate-600"><path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2m10-4H8m4 0v6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                    )}
                    <div className="p-4 sm:p-5">
                      {post.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {post.tags.slice(0, 2).map(tag => (
                            <span key={tag} className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'var(--portal-accent-light)', color: 'var(--portal-accent-dark)' }}>{tag}</span>
                          ))}
                        </div>
                      )}
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm sm:text-base leading-snug group-hover:[color:var(--portal-accent)] transition-colors line-clamp-2">{post.title}</h3>
                      {post.excerpt && <p className="text-xs text-slate-500 mt-2 line-clamp-3">{post.excerpt}</p>}
                      <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-400">
                        {post.publishedAt && <span>{new Date(post.publishedAt).toLocaleDateString()}</span>}
                        {post.authorName && <><span>&middot;</span><span>{post.authorName}</span></>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Détail actualité (news detail) ─────────────────── */}
        {section === 'news-detail' && selectedPost && (
          <div className="max-w-3xl mx-auto">
            <button onClick={() => { setSection('news'); setSelectedPost(null); }} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-6 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              {t('portail.backToNews')}
            </button>

            {selectedPost.coverImageUrl && (
              <div className="aspect-video rounded-2xl overflow-hidden mb-6">
                <img src={selectedPost.coverImageUrl} alt="" className="w-full h-full object-cover" />
              </div>
            )}

            {selectedPost.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedPost.tags.map(tag => (
                  <span key={tag} className="text-xs font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full" style={{ background: 'var(--portal-accent-light)', color: 'var(--portal-accent-dark)' }}>{tag}</span>
                ))}
              </div>
            )}

            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white leading-tight">{selectedPost.title}</h1>

            <div className="flex items-center gap-3 mt-3 text-sm text-slate-400">
              {selectedPost.publishedAt && <span>{new Date(selectedPost.publishedAt).toLocaleDateString()}</span>}
              {selectedPost.authorName && <><span>&middot;</span><span>{selectedPost.authorName}</span></>}
            </div>

            {/* Article content (HTML) — sanitized via DOMPurify pour éviter
                XSS (le contenu vient de l'admin tenant via /portal/posts).
                Un tenant compromis ou un bug d'injection côté CMS serait
                bloqué ici, pas juste par CSP. */}
            <div
              className="prose prose-slate dark:prose-invert max-w-none mt-8 prose-img:rounded-xl prose-a:[color:var(--portal-accent)]"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedPost.content || '') }}
            />

            {/* Media gallery */}
            {(selectedPost.media ?? []).length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-4">{t('portail.newsGallery')}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(selectedPost.media ?? []).map((m, i) => (
                    <div key={i} className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                      {m.type === 'IMAGE' && m.signedUrl && (
                        <img src={m.signedUrl} alt={m.caption || ''} className="w-full aspect-video object-cover" />
                      )}
                      {m.type === 'VIDEO' && m.signedUrl && (
                        <video src={m.signedUrl} controls className="w-full aspect-video" />
                      )}
                      {m.caption && <p className="p-3 text-xs text-slate-500">{m.caption}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      </div>{/* end flex-1 content */}

      {/* ── Footer (layout-variant) ────────────────────────────── */}
      {layout === 'horizon' ? (
        <HorizonFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} newsCmsEnabled={newsCmsEnabled} />
      ) : layout === 'vivid' ? (
        <VividFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} newsCmsEnabled={newsCmsEnabled} />
      ) : layout === 'prestige' ? (
        <PrestigeFooter brandName={brandName} brandLogo={brandLogo} nav={navItems} onSection={handleSection} accent={portalTheme.accent} accentDark={portalTheme.accentDark} t={t} newsCmsEnabled={newsCmsEnabled} />
      ) : (
        <footer className="border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 mt-auto shrink-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
              <div><div className="flex items-center gap-2 mb-3">{brandLogo ? <img src={brandLogo} alt="" className="w-8 h-8 rounded-lg object-cover" /> : <div className="w-8 h-8 rounded-lg bg-[image:linear-gradient(to_bottom_right,var(--portal-accent),var(--portal-accent-dark))] flex items-center justify-center text-white font-bold text-xs">{brandName.charAt(0)}</div>}<span className="font-bold text-slate-900 dark:text-white">{brandName}</span></div><p className="text-xs text-slate-500 leading-relaxed">{t('portail.footerAbout')}</p></div>
              <div><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">{t('portail.footerLinks')}</p><div className="space-y-2">{NAV.map(n => <button key={n.key} onClick={() => handleSection(n.key)} className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600 transition-colors">{n.label}</button>)}{newsCmsEnabled && <button onClick={() => handleSection('news')} className="block text-sm text-slate-600 dark:text-slate-400 hover:text-amber-600 transition-colors">{t('portail.newsTitle')}</button>}</div></div>
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
