/**
 * PageDisplayQuai — Affichage quai (QuaiScreen) avec sélecteur de quai + plein écran
 *
 * Routes : display-quais (admin), qa-display (agent quai)
 *
 * Principes :
 *   ✓ i18n 8 langues — zéro hardcode
 *   ✓ Dark mode natif (Tailwind dark:)
 *   ✓ WCAG : aria-labels, focus visible, rôles sémantiques
 *   ✓ Responsive : toolbar collapsible, display adaptatif
 *   ✓ Fullscreen API pour projection TV/LED
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Maximize2, Minimize2, MapPinned, Eye } from 'lucide-react';
import { cn }                from '../../lib/utils';
import { useI18n }           from '../../lib/i18n/useI18n';
import { useAuth }           from '../../lib/auth/auth.context';
import { useFetch }          from '../../lib/hooks/useFetch';
import { QuaiScreen }        from '../display/QuaiScreen';

// ─── Données fallback quais ─────────────────────────────────────────────────
// TODO: Wire to a richer display endpoint (GET /api/tenants/:tid/platforms/:id/display)
//       that joins Platform + current Trip + passengers info.
//       Currently GET /api/v1/tenants/:tid/platforms only returns basic platform data
//       (code, station, capacity) without trip/departure/passenger details.

const FALLBACK_PLATFORMS = [
  {
    id: 'plt-a1', code: 'A1', stationName: 'Gare Routière de Brazzaville',
    destination: 'POINTE-NOIRE', destinationCode: 'PNR',
    via: 'Dolisie · Loubomo', departureTime: '08:00',
    agencyName: 'Transco', busPlate: 'BZV 7732 GH', busModel: 'Mercedes-Benz Actros',
    driverName: 'Jean-Baptiste Mavoungou',
    passengersConfirmed: 47, passengersOnBoard: 31, capacity: 50,
    parcelsLoaded: 18, statusId: 'BOARDING',
  },
  {
    id: 'plt-a2', code: 'A2', stationName: 'Gare Routière de Brazzaville',
    destination: 'DOLISIE', destinationCode: 'DOL',
    via: 'Madingou · N\'Kayi', departureTime: '08:30',
    agencyName: 'Sotraco', busPlate: 'BZV 1105 CD', busModel: 'Iveco Crossway',
    driverName: 'Alphonse Nganga',
    passengersConfirmed: 32, passengersOnBoard: 22, capacity: 45,
    parcelsLoaded: 8, statusId: 'SCHEDULED',
  },
  {
    id: 'plt-b1', code: 'B1', stationName: 'Gare Routière de Brazzaville',
    destination: 'OUESSO', destinationCode: 'OUE',
    via: 'Owando · Gamboma', departureTime: '09:00',
    agencyName: 'STPU', busPlate: 'BZV 9001 IJ', busModel: 'Scania Citywide',
    driverName: 'Serge Moukoko',
    passengersConfirmed: 28, passengersOnBoard: 12, capacity: 55,
    parcelsLoaded: 22, statusId: 'SCHEDULED',
  },
  {
    id: 'plt-c1', code: 'C1', stationName: 'Gare de Pointe-Noire',
    destination: 'BRAZZAVILLE', destinationCode: 'BZV',
    via: 'Dolisie · Sibiti', departureTime: '07:30',
    agencyName: 'Transco', busPlate: 'PNR 4490 EF', busModel: 'Mercedes-Benz Tourismo',
    driverName: 'Pascal Massamba',
    passengersConfirmed: 50, passengersOnBoard: 48, capacity: 50,
    parcelsLoaded: 12, statusId: 'BOARDING_COMPLETE',
  },
];

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDisplayQuai() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const tenantId       = user?.tenantId;

  // ── Fetch platforms from API (basic data — code, station, capacity) ───────
  // The display-rich fields (destination, passengers, driver…) are not yet
  // available from the platforms list endpoint. Once a dedicated
  // GET /api/tenants/:tid/platforms/:id/display endpoint exists, wire it here.
  const platformsRes = useFetch<any[]>(
    tenantId ? `/api/v1/tenants/${tenantId}/platforms` : null,
    [tenantId],
  );

  // Map API platforms to the shape expected by the selector / QuaiScreen.
  // Since the API lacks trip details, we only use it for the selector list;
  // display data falls back to FALLBACK_PLATFORMS entries when available.
  const platforms = (() => {
    if (!platformsRes.data?.length) return FALLBACK_PLATFORMS;
    // Merge API platforms with any matching fallback data for richer display
    return platformsRes.data.map(p => {
      const fallback = FALLBACK_PLATFORMS.find(f => f.code === p.code);
      return fallback ?? {
        id: p.id,
        code: p.code,
        stationName: p.station?.name ?? '',
        destination: '—',
        destinationCode: '—',
        via: '',
        departureTime: '—',
        agencyName: '',
        busPlate: '—',
        busModel: '',
        driverName: '',
        passengersConfirmed: 0,
        passengersOnBoard: 0,
        capacity: p.capacity ?? 0,
        parcelsLoaded: 0,
        statusId: 'SCHEDULED',
      };
    });
  })();

  const [selectedPlatform, setSelectedPlatform] = useState(platforms[0]);
  const [isFullscreen, setIsFullscreen]         = useState(false);
  const [showToolbar, setShowToolbar]           = useState(true);
  const displayRef = useRef<HTMLDivElement>(null);

  // ── Sync selectedPlatform when API data arrives ───────────────────────────
  useEffect(() => {
    if (platforms.length && !platforms.find(p => p.id === selectedPlatform.id)) {
      setSelectedPlatform(platforms[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformsRes.data]);

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

  // Build departAt from demo time
  const departAt = (() => {
    const [h, m] = selectedPlatform.departureTime.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  })();

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
          <MapPinned className="w-5 h-5 text-[var(--color-primary)]" aria-hidden />
          <h1 className="text-base lg:text-lg font-bold text-white">
            {t('displayPage.platformDisplay')}
          </h1>
        </div>

        {/* Sélecteur de quai */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label htmlFor="platform-select" className="text-xs text-slate-400 shrink-0">
            {t('displayPage.selectPlatform')}
          </label>
          <select
            id="platform-select"
            value={selectedPlatform.id}
            onChange={e => {
              const plt = platforms.find(p => p.id === e.target.value);
              if (plt) setSelectedPlatform(plt);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium min-w-0',
              'bg-slate-800 dark:bg-slate-800 text-white border border-slate-700 dark:border-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
          >
            {platforms.map(p => (
              <option key={p.id} value={p.id}>
                {t('displayPage.platformLabel')} {p.code} — {p.destination} ({p.stationName})
              </option>
            ))}
          </select>
        </div>

        {/* Status badge */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <span className={cn(
            'px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider',
            selectedPlatform.statusId === 'BOARDING'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : selectedPlatform.statusId === 'BOARDING_COMPLETE'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-slate-700/50 text-slate-400 border border-slate-600',
          )}>
            {t(`status.${selectedPlatform.statusId}`)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={`/display/quai/${selectedPlatform.id}`}
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
        <QuaiScreen
          platform={selectedPlatform.code}
          destination={selectedPlatform.destination}
          destinationCode={selectedPlatform.destinationCode}
          via={selectedPlatform.via}
          departureTime={selectedPlatform.departureTime}
          agencyName={selectedPlatform.agencyName}
          busPlate={selectedPlatform.busPlate}
          busModel={selectedPlatform.busModel}
          driverName={selectedPlatform.driverName}
          passengersConfirmed={selectedPlatform.passengersConfirmed}
          passengersOnBoard={selectedPlatform.passengersOnBoard}
          capacity={selectedPlatform.capacity}
          parcelsLoaded={selectedPlatform.parcelsLoaded}
          statusId={selectedPlatform.statusId}
          departAt={departAt}
          tenantId={user?.tenantId ?? 'demo'}
          autoRotateLang={isFullscreen}
        />
      </div>
    </div>
  );
}

export default PageDisplayQuai;
