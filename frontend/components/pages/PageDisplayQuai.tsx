/**
 * PageDisplayQuai — Affichage quai (QuaiScreen) avec sélecteur de quai + plein écran
 *
 * Données réelles :
 *   - Liste des quais   : GET /api/v1/tenants/:tid/platforms        (auth requise)
 *   - Détails enrichis  : GET /api/tenants/:tid/platforms/:id/display
 *     (public — pas d'auth, fan-out écrans kiosque)
 *
 * Auto-refresh toutes les 30 s du quai sélectionné pour les changements de
 * statut, passagers et colis. WebSocket temps réel : prévu phase suivante
 * (cf. display.gateway.ts event fan-out).
 *
 * Principes UI :
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlatformLite {
  id:       string;
  code:     string;
  name?:    string;
  capacity: number;
  status:   string;
  station?: { id: string; name: string; city: string };
}

interface PlatformDisplayData {
  id:                  string;
  code:                string;
  name:                string;
  stationName:         string;
  stationCity?:        string;
  capacity:            number;
  statusId:            string;
  delayMinutes?:       number;
  tripId:              string | null;
  destination:         string;
  destinationCode:     string;
  via:                 string;
  departureTime:       string;
  departAt:            string | null;
  busPlate:            string;
  busModel:            string;
  driverName:          string;
  agencyName:          string;
  passengersConfirmed: number;
  passengersCheckedIn?: number;
  passengersOnBoard:   number;
  parcelsLoaded:       number;
  parcelsTotal?:       number;
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function PageDisplayQuai() {
  const { t }          = useI18n();
  const { user }       = useAuth();
  const tenantId       = user?.tenantId;

  // ── 1. Liste des quais pour le sélecteur ──────────────────────────────────
  const platformsRes = useFetch<PlatformLite[]>(
    tenantId ? `/api/v1/tenants/${tenantId}/platforms` : null,
    [tenantId],
  );
  const platforms = platformsRes.data ?? [];

  // ── 2. Sélection + fetch enrichi du quai courant ──────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (platforms.length && !selectedId) {
      setSelectedId(platforms[0].id);
    } else if (selectedId && platforms.length && !platforms.find(p => p.id === selectedId)) {
      setSelectedId(platforms[0]?.id ?? null);
    }
  }, [platforms, selectedId]);

  const displayUrl = tenantId && selectedId
    ? `/api/tenants/${tenantId}/platforms/${selectedId}/display`
    : null;

  const displayRes = useFetch<PlatformDisplayData>(
    displayUrl,
    [displayUrl],
  );

  // Auto-refresh polling 10s — compromis temps réel perçu / charge backend.
  // Les comptages sont Prisma.count() donc O(1) avec index (tripId, status),
  // ~5-10ms/appel. Cadence s'aligne sur BusScreen (même périodicité perçue
  // sur les deux écrans). WebSocket/SSE prévu en phase 2 pour le <1s latence.
  useEffect(() => {
    if (!displayUrl) return;
    const id = setInterval(() => displayRes.refetch(), 10_000);
    return () => clearInterval(id);
  }, [displayUrl, displayRes]);

  const data = displayRes.data;

  // ── 3. UI state (fullscreen, toolbar) ─────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showToolbar, setShowToolbar]   = useState(true);
  const displayRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    if (!displayRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await displayRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch { /* fullscreen not supported */ }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

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

  // ── departAt pour QuaiScreen countdown ────────────────────────────────────
  const departAt = (() => {
    if (data?.departAt) return new Date(data.departAt);
    // Fallback : aujourd'hui à l'heure de départ texte si disponible
    if (data?.departureTime && data.departureTime !== '') {
      const [h, m] = data.departureTime.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    }
    return new Date();
  })();

  // ── États spéciaux ────────────────────────────────────────────────────────
  const showNoPlatforms  = !platformsRes.loading && platforms.length === 0;
  const showLoadingState = displayRes.loading && !data;

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
        <div className="flex items-center gap-2 mr-2">
          <MapPinned className="w-5 h-5 text-[var(--color-primary)]" aria-hidden />
          <h1 className="text-base lg:text-lg font-bold text-white">
            {t('displayPage.platformDisplay')}
          </h1>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <label htmlFor="platform-select" className="text-xs text-slate-400 shrink-0">
            {t('displayPage.selectPlatform')}
          </label>
          <select
            id="platform-select"
            value={selectedId ?? ''}
            onChange={e => setSelectedId(e.target.value || null)}
            disabled={platforms.length === 0}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm font-medium min-w-0',
              'bg-slate-800 dark:bg-slate-800 text-white border border-slate-700 dark:border-slate-700',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]',
              'disabled:opacity-50',
            )}
          >
            {platforms.length === 0 && (
              <option value="">{t('displayPage.noPlatforms')}</option>
            )}
            {platforms.map(p => (
              <option key={p.id} value={p.id}>
                {t('displayPage.platformLabel')} {p.code}
                {p.station?.name ? ` — ${p.station.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        {data && (
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <span className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider',
              data.statusId === 'BOARDING'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : data.statusId === 'IN_PROGRESS' || data.statusId === 'OCCUPIED'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : data.statusId === 'IN_PROGRESS_DELAYED'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-slate-700/50 text-slate-400 border border-slate-600',
            )}>
              {t(`status.${data.statusId}`) || data.statusId}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {selectedId && (
            <a
              href={`/display/quai/${selectedId}`}
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
        {showNoPlatforms ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            {t('displayPage.noPlatforms')}
          </div>
        ) : showLoadingState ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm" aria-busy="true">
            {t('displayPage.loading')}
          </div>
        ) : data ? (
          <QuaiScreen
            platform={data.code}
            destination={data.destination || t('displayPage.awaitingAssignment')}
            destinationCode={data.destinationCode}
            via={data.via}
            departureTime={data.departureTime || '—'}
            agencyName={data.agencyName}
            busPlate={data.busPlate}
            busModel={data.busModel}
            driverName={data.driverName}
            passengersConfirmed={data.passengersConfirmed}
            passengersCheckedIn={data.passengersCheckedIn}
            passengersOnBoard={data.passengersOnBoard}
            capacity={data.capacity}
            parcelsLoaded={data.parcelsLoaded}
            parcelsTotal={data.parcelsTotal}
            statusId={data.statusId}
            departAt={departAt}
            delayMinutes={data.delayMinutes ?? 0}
            tenantId={user?.tenantId ?? 'demo'}
            autoRotateLang={isFullscreen}
          />
        ) : null}
      </div>
    </div>
  );
}

export default PageDisplayQuai;
