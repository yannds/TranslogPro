/**
 * PageDisplayGare — Affichage gare (DepartureBoard) avec sélecteur de gare + plein écran
 *
 * Routes : display-screens (admin), sa-display (agent gare)
 *
 * Principes :
 *   ✓ i18n 8 langues — zéro hardcode
 *   ✓ Dark mode natif (Tailwind dark:)
 *   ✓ WCAG : aria-labels, focus visible, rôles sémantiques
 *   ✓ Responsive : toolbar collapsible, display adaptatif
 *   ✓ Fullscreen API pour projection TV
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { Maximize2, Minimize2, Monitor, Eye } from 'lucide-react';
import { cn }                from '../../lib/utils';
import { useI18n }           from '../../lib/i18n/useI18n';
import { useAuth }           from '../../lib/auth/auth.context';
import { useFetch }          from '../../lib/hooks/useFetch';
import { DepartureBoard }    from '../display/DepartureBoard';

// ─── Données fallback gares ─────────────────────────────────────────────────

const FALLBACK_STATIONS = [
  { id: 'stn-bzv', name: 'Gare Routière de Brazzaville', city: 'Brazzaville' },
  { id: 'stn-pnr', name: 'Gare de Pointe-Noire',        city: 'Pointe-Noire' },
  { id: 'stn-dol', name: 'Gare de Dolisie',              city: 'Dolisie' },
  { id: 'stn-oue', name: 'Gare Routière d\'Ouesso',      city: 'Ouesso' },
  { id: 'stn-nky', name: 'Gare de N\'Kayi',              city: 'N\'Kayi' },
];

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDisplayGare() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const tenantId       = user?.tenantId;

  // ── Fetch real stations from API ──────────────────────────────────────────
  const stationsRes = useFetch<{ id: string; name: string; city: string }[]>(
    tenantId ? `/api/tenants/${tenantId}/stations` : null,
    [tenantId],
  );
  const ALL_STATION = { id: '__all__', name: t('displayPage.allStations'), city: '' };
  const realStations = stationsRes.data?.length ? stationsRes.data : FALLBACK_STATIONS;
  const stations = [ALL_STATION, ...realStations];

  const [selectedStation, setSelectedStation] = useState(ALL_STATION);
  const [isFullscreen, setIsFullscreen]       = useState(false);
  const [showToolbar, setShowToolbar]         = useState(true);
  const displayRef = useRef<HTMLDivElement>(null);

  // ── Sync selectedStation when API data arrives ────────────────────────────
  useEffect(() => {
    if (stationsRes.data?.length) {
      const still = stationsRes.data.find(s => s.id === selectedStation.id);
      if (!still) setSelectedStation(stationsRes.data[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationsRes.data]);

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
      // Fullscreen not supported — ignore silently
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
          <Monitor className="w-5 h-5 text-[var(--color-primary)]" aria-hidden />
          <h1 className="text-base lg:text-lg font-bold text-white">
            {t('displayPage.stationDisplay')}
          </h1>
        </div>

        {/* Sélecteur de gare */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label htmlFor="station-select" className="text-xs text-slate-400 shrink-0">
            {t('displayPage.selectStation')}
          </label>
          <select
            id="station-select"
            value={selectedStation.id}
            onChange={e => {
              const stn = stations.find(s => s.id === e.target.value);
              if (stn) setSelectedStation(stn);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium min-w-0',
              'bg-slate-800 dark:bg-slate-800 text-white border border-slate-700 dark:border-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
            )}
          >
            {stations.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Preview link */}
          <a
            href={`/display/gare/${selectedStation.id}`}
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

          {/* Fullscreen */}
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
        <DepartureBoard
          stationName={selectedStation.name}
          stationId={selectedStation.id}
          tenantId={user?.tenantId ?? 'demo'}
          autoRotateLang={isFullscreen}
        />
      </div>
    </div>
  );
}

export default PageDisplayGare;
