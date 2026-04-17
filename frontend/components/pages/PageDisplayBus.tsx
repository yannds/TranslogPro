/**
 * PageDisplayBus — Affichage embarqué bus (BusScreen) avec sélecteur de trajet + plein écran
 *
 * Route : display-bus (admin), future route agent
 *
 * Principes :
 *   ✓ i18n 8 langues — zéro hardcode
 *   ✓ Dark mode natif (Tailwind dark:)
 *   ✓ WCAG : aria-labels, focus visible, rôles sémantiques
 *   ✓ Responsive : toolbar collapsible, display adaptatif
 *   ✓ Fullscreen API pour projection écran embarqué
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Maximize2, Minimize2, Bus, Eye } from 'lucide-react';
import { cn }                from '../../lib/utils';
import { useI18n }           from '../../lib/i18n/useI18n';
import { useAuth }           from '../../lib/auth/auth.context';
import { useFetch }          from '../../lib/hooks/useFetch';
import { BusScreen }         from '../display/BusScreen';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DemoTrip {
  id:               string;
  tripRef:          string;
  routeLabel:       string;
  destinationCode:  string;
  busPlate:         string;
  busModel:         string;
  driverName:       string;
  agencyName:       string;
  capacity:         number;
  passengersOnBoard: number;
  parcelsOnBoard:   number;
}

// ─── Données fallback trajets en cours ───────────────────────────────────────

const FALLBACK_TRIPS: DemoTrip[] = [
  {
    id: 'trp-001', tripRef: 'TRP-20260417-001',
    routeLabel: 'Brazzaville → Pointe-Noire', destinationCode: 'PNR',
    busPlate: 'BZV 4321 GH', busModel: 'Mercedes-Benz Actros',
    driverName: 'Jean-Baptiste Mavoungou', agencyName: 'Transco',
    capacity: 50, passengersOnBoard: 38, parcelsOnBoard: 14,
  },
  {
    id: 'trp-002', tripRef: 'TRP-20260417-002',
    routeLabel: 'Pointe-Noire → Dolisie', destinationCode: 'DOL',
    busPlate: 'PNR 1122 AA', busModel: 'Iveco Crossway',
    driverName: 'Alphonse Nganga', agencyName: 'Sotraco',
    capacity: 45, passengersOnBoard: 29, parcelsOnBoard: 7,
  },
  {
    id: 'trp-003', tripRef: 'TRP-20260417-003',
    routeLabel: 'Brazzaville → Ouesso', destinationCode: 'OUE',
    busPlate: 'BZV 9001 IJ', busModel: 'Scania Citywide',
    driverName: 'Serge Moukoko', agencyName: 'STPU',
    capacity: 55, passengersOnBoard: 42, parcelsOnBoard: 19,
  },
  {
    id: 'trp-004', tripRef: 'TRP-20260417-004',
    routeLabel: 'Dolisie → Brazzaville', destinationCode: 'BZV',
    busPlate: 'DOL 5678 GG', busModel: 'Mercedes-Benz Tourismo',
    driverName: 'Pascal Massamba', agencyName: 'Onemo',
    capacity: 48, passengersOnBoard: 35, parcelsOnBoard: 11,
  },
];

// ─── API Trip → DemoTrip mapper ──────────────────────────────────────────────

function apiTripToDemoTrip(trip: any): DemoTrip {
  const origin = trip.route?.origin?.city ?? trip.route?.origin?.name ?? '';
  const dest   = trip.route?.destination?.city ?? trip.route?.destination?.name ?? '';
  return {
    id:                trip.id,
    tripRef:           trip.tripRef ?? trip.id.slice(0, 20),
    routeLabel:        `${origin} → ${dest}`,
    destinationCode:   trip.route?.destination?.city?.slice(0, 3).toUpperCase() ?? '—',
    busPlate:          trip.bus?.plateNumber ?? '—',
    busModel:          trip.bus?.model ?? '',
    driverName:        '',
    agencyName:        '',
    capacity:          trip.bus?.capacity ?? 0,
    passengersOnBoard: trip.passengersOnBoard ?? 0,
    parcelsOnBoard:    trip.parcelsOnBoard ?? 0,
  };
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDisplayBus() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const tenantId       = user?.tenantId;

  // ── Fetch active trips from API ───────────────────────────────────────────
  const tripsRes = useFetch<any[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?status=PLANNED&status=BOARDING&status=IN_PROGRESS` : null,
    [tenantId],
  );
  const trips: DemoTrip[] = (() => {
    if (tripsRes.data?.length) return tripsRes.data.map(apiTripToDemoTrip);
    return FALLBACK_TRIPS;
  })();

  const [selectedTrip, setSelectedTrip] = useState(trips[0]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar]   = useState(true);
  const displayRef = useRef<HTMLDivElement>(null);

  // ── Sync selectedTrip when API data arrives ───────────────────────────────
  useEffect(() => {
    if (trips.length && !trips.find(tr => tr.id === selectedTrip.id)) {
      setSelectedTrip(trips[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripsRes.data]);

  // ── Fullscreen API ─────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(async () => {
    if (!displayRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await displayRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen not supported
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Auto-hide toolbar in fullscreen ────────────────────────────────────────
  useEffect(() => {
    if (isFullscreen) {
      const timer = setTimeout(() => setShowToolbar(false), 3000);
      return () => clearTimeout(timer);
    }
    setShowToolbar(true);
  }, [isFullscreen]);

  const handleMouseMove = useCallback(() => {
    if (isFullscreen) setShowToolbar(true);
  }, [isFullscreen]);

  return (
    <div
      className="flex flex-col h-full"
      onMouseMove={handleMouseMove}
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        role="toolbar"
        aria-label={t('displayPage.toolbar')}
        className={cn(
          'flex flex-wrap items-center gap-3 px-4 lg:px-6 py-3 shrink-0 transition-all duration-300',
          'bg-slate-900 dark:bg-slate-900 border-b border-slate-800 dark:border-slate-800',
          isFullscreen && !showToolbar && 'opacity-0 pointer-events-none -translate-y-full absolute inset-x-0 top-0 z-50',
          isFullscreen && showToolbar && 'opacity-100 absolute inset-x-0 top-0 z-50',
        )}
      >
        {/* Icon + titre */}
        <div className="flex items-center gap-2 mr-2">
          <Bus className="w-5 h-5 text-[var(--color-primary)]" aria-hidden />
          <h1 className="text-base lg:text-lg font-bold text-white">
            {t('displayPage.busDisplay')}
          </h1>
        </div>

        {/* Sélecteur de trajet */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label htmlFor="trip-select" className="text-xs text-slate-400 shrink-0">
            {t('displayPage.selectTrip')}
          </label>
          <select
            id="trip-select"
            value={selectedTrip.id}
            onChange={e => {
              const trip = trips.find(tr => tr.id === e.target.value);
              if (trip) setSelectedTrip(trip);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium min-w-0 max-w-xs lg:max-w-md',
              'bg-slate-800 dark:bg-slate-800 text-white border border-slate-700 dark:border-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
          >
            {trips.map(tr => (
              <option key={tr.id} value={tr.id}>
                {tr.routeLabel} — {tr.busPlate} ({tr.tripRef})
              </option>
            ))}
          </select>
        </div>

        {/* Info bus */}
        <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400 shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {t('displayPage.inTransit')}
          </span>
          <span>{selectedTrip.passengersOnBoard}/{selectedTrip.capacity} {t('col.passengers').toLowerCase()}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`/display/bus/${selectedTrip.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              'bg-slate-800 hover:bg-slate-700 text-slate-300',
              'dark:bg-slate-800 dark:hover:bg-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
            aria-label={t('displayPage.openNewTab')}
          >
            <Eye className="w-3.5 h-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('displayPage.openNewTab')}</span>
          </a>

          <button
            onClick={toggleFullscreen}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
              'text-white',
              isFullscreen
                ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/80'
                : 'bg-slate-800 hover:bg-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
            aria-label={isFullscreen ? t('displayPage.exitFullscreen') : t('displayPage.fullscreen')}
            aria-pressed={isFullscreen}
          >
            {isFullscreen
              ? <Minimize2 className="w-3.5 h-3.5" aria-hidden />
              : <Maximize2 className="w-3.5 h-3.5" aria-hidden />
            }
            <span className="hidden sm:inline">
              {isFullscreen ? t('displayPage.exitFullscreen') : t('displayPage.fullscreen')}
            </span>
          </button>
        </div>
      </div>

      {/* ── Display preview ─────────────────────────────────────────────────── */}
      <div
        ref={displayRef}
        className={cn(
          'flex-1 overflow-hidden',
          isFullscreen ? 'bg-slate-950' : 'bg-slate-950 rounded-b-xl',
        )}
      >
        <BusScreen
          tripRef={selectedTrip.tripRef}
          routeLabel={selectedTrip.routeLabel}
          destinationCode={selectedTrip.destinationCode}
          busPlate={selectedTrip.busPlate}
          busModel={selectedTrip.busModel}
          driverName={selectedTrip.driverName}
          agencyName={selectedTrip.agencyName}
          capacity={selectedTrip.capacity}
          passengersOnBoard={selectedTrip.passengersOnBoard}
          parcelsOnBoard={selectedTrip.parcelsOnBoard}
          tenantId={user?.tenantId ?? 'demo'}
          autoRotateLang={isFullscreen}
        />
      </div>
    </div>
  );
}

export default PageDisplayBus;
