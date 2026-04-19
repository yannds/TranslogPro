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

interface RouteStop {
  id:          string;
  cityCode:    string;
  cityName:    string;
  scheduledAt: string;            // HH:MM
  distanceKm:  number;
  status:      'PASSED' | 'CURRENT' | 'UPCOMING';
}

interface DemoTrip {
  id:                 string;
  tripRef:            string;
  routeLabel:         string;
  destinationCode:    string;
  busPlate:           string;
  busModel:           string;
  driverName:         string;
  agencyName:         string;
  capacity:           number;
  passengersConfirmed: number;
  passengersOnBoard:  number;
  parcelsOnBoard:     number;
  delayMinutes:       number;
  tripStatus:         string;
  departureScheduled: string | null;
  arrivalScheduled:   string | null;
  stops:              RouteStop[];
}

// ─── Format HH:MM depuis un Date ─────────────────────────────────────────────

function fmtHm(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Build stops[] depuis trip.route (origin + waypoints + destination) ──────
// Heures estimées par répartition linéaire entre `departureScheduled` et
// `arrivalScheduled` selon `distanceFromOriginKm`. Pas de GPS — approximation
// suffisante pour l'écran embarqué en MVP.

function buildStops(trip: any): RouteStop[] {
  const route       = trip.route;
  const origin      = route?.origin;
  const destination = route?.destination;
  if (!origin || !destination) return [];

  const departIso = trip.departureScheduled;
  const arriveIso = trip.arrivalScheduled;
  const departTs  = departIso ? new Date(departIso).getTime() : Date.now();
  const arriveTs  = arriveIso ? new Date(arriveIso).getTime() : departTs + 4 * 3_600_000;
  const totalKm   = Number(route?.distanceKm) || 0;

  // Index des waypoints (peut être vide)
  const waypoints: any[] = Array.isArray(route?.waypoints) ? route.waypoints : [];

  const lastStopKm = totalKm > 0
    ? totalKm
    : waypoints.reduce((max, w) => Math.max(max, Number(w.distanceFromOriginKm) || 0), 0) || 1;

  const scheduledAtForKm = (km: number): string => {
    const ratio = Math.max(0, Math.min(1, km / (lastStopKm || 1)));
    return fmtHm(new Date(departTs + ratio * (arriveTs - departTs)));
  };

  const stops: RouteStop[] = [
    {
      id:          origin.id ?? 'origin',
      cityCode:    (origin.city || origin.name || '').slice(0, 3).toUpperCase(),
      cityName:    origin.city || origin.name || '',
      scheduledAt: fmtHm(new Date(departTs)),
      distanceKm:  0,
      status:      'UPCOMING',
    },
    ...waypoints.map((w: any) => {
      const km = Number(w.distanceFromOriginKm) || 0;
      return {
        id:          w.id ?? `wp-${w.order}`,
        cityCode:    (w.station?.city || w.station?.name || '').slice(0, 3).toUpperCase(),
        cityName:    w.station?.city || w.station?.name || '',
        scheduledAt: scheduledAtForKm(km),
        distanceKm:  km,
        status:      'UPCOMING' as const,
      };
    }),
    {
      id:          destination.id ?? 'destination',
      cityCode:    (destination.city || destination.name || '').slice(0, 3).toUpperCase(),
      cityName:    destination.city || destination.name || '',
      scheduledAt: fmtHm(new Date(arriveTs)),
      distanceKm:  lastStopKm,
      status:      'UPCOMING',
    },
  ];

  // Calcul du statut : le stop dont le scheduledAt est le plus proche sans
  // dépasser l'heure actuelle est CURRENT ; les antérieurs PASSED ; les
  // suivants UPCOMING.
  const now = Date.now();
  const stopTs = stops.map((_, i) => {
    const km = i === 0 ? 0 : i === stops.length - 1 ? lastStopKm : stops[i].distanceKm;
    return departTs + (km / (lastStopKm || 1)) * (arriveTs - departTs);
  });
  // Index du dernier stop dépassé
  let passedIdx = -1;
  for (let i = 0; i < stopTs.length; i++) {
    if (stopTs[i] <= now) passedIdx = i;
  }
  // Statuts : [0..passedIdx-1] = PASSED ; passedIdx = CURRENT ; le reste = UPCOMING.
  // Si aucun stop dépassé (now < depart) → tous UPCOMING.
  // Si tous dépassés (now > arrive) → tous PASSED + dernier CURRENT.
  stops.forEach((s, i) => {
    if (passedIdx < 0) {
      s.status = 'UPCOMING';
    } else if (i < passedIdx) {
      s.status = 'PASSED';
    } else if (i === passedIdx) {
      s.status = 'CURRENT';
    } else {
      s.status = 'UPCOMING';
    }
  });

  return stops;
}

// ─── API Trip → DemoTrip mapper ──────────────────────────────────────────────

function apiTripToDemoTrip(trip: any): DemoTrip {
  const origin = trip.route?.origin?.city ?? trip.route?.origin?.name ?? '';
  const dest   = trip.route?.destination?.city ?? trip.route?.destination?.name ?? '';
  return {
    id:                 trip.id,
    tripRef:            trip.tripRef ?? trip.id.slice(0, 20),
    routeLabel:         `${origin} → ${dest}`,
    destinationCode:    trip.route?.destination?.city?.slice(0, 3).toUpperCase() ?? '—',
    busPlate:           trip.bus?.plateNumber ?? '—',
    busModel:           trip.bus?.model ?? '',
    driverName:         trip.driver?.user?.name ?? '',
    agencyName:         '',
    capacity:           trip.bus?.capacity ?? 0,
    // Compteurs live : remplacés par le fetch /live-stats côté composant.
    // On met 0 par défaut pour éviter que les defaults démo de BusScreen
    // s'affichent via prop undefined (ex: 38 passagers fictifs).
    passengersConfirmed: 0,
    passengersOnBoard:   0,
    parcelsOnBoard:      0,
    delayMinutes:        0,
    tripStatus:          trip.status ?? '',
    departureScheduled:  trip.departureScheduled ?? null,
    arrivalScheduled:    trip.arrivalScheduled   ?? null,
    stops:               buildStops(trip),
  };
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDisplayBus() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const tenantId       = user?.tenantId;

  // ── Fetch active trips from API ───────────────────────────────────────────
  const tripsUrl = tenantId
    ? `/api/tenants/${tenantId}/trips?status=PLANNED&status=BOARDING&status=IN_PROGRESS`
    : null;
  const tripsRes = useFetch<any[]>(tripsUrl, [tenantId]);

  const trips: DemoTrip[] = (tripsRes.data ?? []).map(apiTripToDemoTrip);

  // Refresh liste trajets toutes les 30 s (changements de statut, nouveau départ).
  useEffect(() => {
    if (!tripsUrl) return;
    const id = setInterval(() => tripsRes.refetch(), 30_000);
    return () => clearInterval(id);
  }, [tripsUrl, tripsRes]);

  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const selectedTripRaw = trips.find(tr => tr.id === selectedTripId) ?? trips[0] ?? null;

  // ── Fetch live stats pour le trajet sélectionné (polling 10s) ─────────────
  // Source de vérité UNIQUE pour passengersOnBoard / parcelsOnBoard — même
  // endpoint que QuaiScreen utilise (indirectement via display.service), donc
  // les deux écrans affichent toujours les mêmes compteurs pour le même trip.
  const liveStatsUrl = tenantId && selectedTripRaw?.id
    ? `/api/tenants/${tenantId}/flight-deck/trips/${selectedTripRaw.id}/live-stats`
    : null;
  const liveStatsRes = useFetch<{
    passengersOnBoard:   number;
    passengersConfirmed: number;
    parcelsLoaded:       number;
    busCapacity:         number;
    delayMinutes:        number;
    tripStatus:          string;
    scheduledDeparture:  string | null;
    updatedAt:           string;
  } | null>(liveStatsUrl, [liveStatsUrl]);

  useEffect(() => {
    if (!liveStatsUrl) return;
    const id = setInterval(() => liveStatsRes.refetch(), 10_000);
    return () => clearInterval(id);
  }, [liveStatsUrl, liveStatsRes]);

  // Fusionne les compteurs live dans le trajet affiché.
  const selectedTrip: DemoTrip | null = selectedTripRaw
    ? {
        ...selectedTripRaw,
        passengersOnBoard:   liveStatsRes.data?.passengersOnBoard   ?? 0,
        passengersConfirmed: liveStatsRes.data?.passengersConfirmed ?? 0,
        parcelsOnBoard:      liveStatsRes.data?.parcelsLoaded       ?? 0,
        capacity:            liveStatsRes.data?.busCapacity         ?? selectedTripRaw.capacity,
        delayMinutes:        liveStatsRes.data?.delayMinutes        ?? 0,
        tripStatus:          liveStatsRes.data?.tripStatus          ?? selectedTripRaw.tripStatus,
      }
    : null;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar]   = useState(true);
  const displayRef = useRef<HTMLDivElement>(null);

  // ── Sync selectedTrip when API data arrives / change ──────────────────────
  useEffect(() => {
    if (trips.length && (!selectedTripId || !trips.find(tr => tr.id === selectedTripId))) {
      setSelectedTripId(trips[0].id);
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
            value={selectedTrip?.id ?? ''}
            onChange={e => setSelectedTripId(e.target.value || null)}
            disabled={trips.length === 0}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium min-w-0 max-w-xs lg:max-w-md',
              'bg-slate-800 dark:bg-slate-800 text-white border border-slate-700 dark:border-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              'disabled:opacity-50',
            )}
          >
            {trips.length === 0 && (
              <option value="">{t('displayPage.noActiveTrips')}</option>
            )}
            {trips.map(tr => (
              <option key={tr.id} value={tr.id}>
                {tr.routeLabel} — {tr.busPlate} ({tr.tripRef})
              </option>
            ))}
          </select>
        </div>

        {/* Info bus */}
        {selectedTrip && (
          <div className="hidden lg:flex items-center gap-3 text-xs text-slate-400 shrink-0">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('displayPage.inTransit')}
            </span>
            <span>{selectedTrip.passengersOnBoard}/{selectedTrip.capacity} {t('col.passengers').toLowerCase()}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {selectedTrip && (
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
          )}

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
        {selectedTrip ? (
          <BusScreen
            tripRef={selectedTrip.tripRef}
            routeLabel={selectedTrip.routeLabel}
            destinationCode={selectedTrip.destinationCode}
            stops={selectedTrip.stops.length > 0 ? selectedTrip.stops : undefined}
            busPlate={selectedTrip.busPlate}
            busModel={selectedTrip.busModel}
            driverName={selectedTrip.driverName}
            agencyName={selectedTrip.agencyName}
            capacity={selectedTrip.capacity}
            passengersConfirmed={selectedTrip.passengersConfirmed}
            passengersOnBoard={selectedTrip.passengersOnBoard}
            parcelsOnBoard={selectedTrip.parcelsOnBoard}
            delayMinutes={selectedTrip.delayMinutes}
            scheduledDeparture={
              selectedTrip.departureScheduled
                ? new Date(selectedTrip.departureScheduled).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : undefined
            }
            tenantId={user?.tenantId ?? 'demo'}
            autoRotateLang={isFullscreen}
          />
        ) : tripsRes.loading ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm" aria-busy="true">
            {t('displayPage.loading')}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            {t('displayPage.noActiveTrips')}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageDisplayBus;
