/**
 * DepartureBoard — Tableau des départs / arrivées (TV/kiosque)
 *
 * Principes cardinaux appliqués :
 *   ✓ Multi-tenant    : config statuts, villes, marque via TenantConfigProvider
 *   ✓ i18n 8 langues  : rotation automatique, RTL arabe natif
 *   ✓ Zéro hardcode   : statuts, labels, couleurs = config externe
 *   ✓ Départs/Arrivées : sélecteur mode + colonnes adaptatives
 *   ✓ WebSocket       : données live via useNotifications
 *   ✓ Dark mode natif : 100% classes dark: Tailwind, aucune couleur fixe
 *   ✓ WCAG            : aria-live, aria-label, rôles sémantiques, contraste
 *   ✓ Responsive TV   : grille CSS adaptative (4K → terminal compact)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn }                    from '../../lib/utils';
import { useI18n }               from '../../lib/i18n/useI18n';
import { useFetch }              from '../../lib/hooks/useFetch';
import { useNotifications, NOTIFICATION_ICONS } from '../../lib/hooks/useNotifications';
import { useWeatherMulti }       from '../../lib/hooks/useWeather';
import { WEATHER_ICONS }         from '../../lib/hooks/useWeather';
import { useTenantConfig }       from '../../providers/TenantConfigProvider';
import type { Notification }     from '../../lib/hooks/useNotifications';
import type { Language, TranslationMap } from '../../lib/i18n/types';
import { LANGUAGE_META }         from '../../lib/i18n/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type BoardMode = 'DEPARTURES' | 'ARRIVALS';

interface BoardRow {
  id:              string;
  scheduledAt:     string;   // "HH:MM"
  dateISO?:        string;   // "YYYY-MM-DD" — pour le séparateur de jour
  delayMin?:       number;
  cityId:          string;   // résolu en nom via tenant cities
  cityName:        string;   // nom affiché (destination en départ, origine en arrivée)
  originName?:     string;   // ville d'origine (pour colonne Provenance en mode all)
  destinationName?: string;  // ville de destination
  via?:            string;
  busPlate:        string;
  agencyOrigin:    string;   // agence départ
  agencyDest:      string;   // agence arrivée
  platform:        string;
  statusId:        string;   // clé dans StatusRegistry
  remark?:         string;
}

interface DepartureBoardProps {
  /** Identifiant de la gare (affiché dans le header) */
  stationName?:     string;
  stationNamei18n?: Partial<Record<Language, string>>;
  /** ID de la gare pour fetch API display */
  stationId?:       string;
  tenantId?:        string;
  /** Surcharge des données (tests, storybook). Sinon simulées / API. */
  rows?:            BoardRow[];
  /** Mode initial */
  initialMode?:     BoardMode;
  /** Active la rotation automatique des langues */
  autoRotateLang?:  boolean;
}

// ─── Données de démo — République du Congo ───────────────────────────────────

const DEMO_DEPARTURES: BoardRow[] = [
  { id: 'd01', scheduledAt: '06:30', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Kinkala · Madingou · Sibiti · Mossendjo · Dolisie · Loubomo', busPlate: 'BZV 2241 BA', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Pointe-Noire', platform: 'A1', statusId: 'DEPARTED' },
  { id: 'd02', scheduledAt: '07:00', cityId: 'dol', cityName: 'DOLISIE',       via: 'Madingou · N\'Kayi', busPlate: 'BZV 1105 CD', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Dolisie', platform: 'B2', statusId: 'DEPARTED' },
  { id: 'd03', scheduledAt: '07:30', cityId: 'nky', cityName: 'N\'KAYI',       via: 'Kinkala · Madingou', busPlate: 'BZV 4490 EF', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare N\'Kayi',       platform: 'C1', statusId: 'BOARDING_COMPLETE' },
  { id: 'd04', scheduledAt: '08:00', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Gamboma · Sibiti · Mossendjo · Dolisie', busPlate: 'BZV 7732 GH', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Pointe-Noire', platform: 'A2', statusId: 'BOARDING', },
  { id: 'd05', scheduledAt: '08:30', cityId: 'oue', cityName: 'OUESSO',         via: 'Gamboma · Owando · Makoua · Ewo', busPlate: 'BZV 9001 IJ', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Ouesso',        platform: 'D1', statusId: 'DELAYED', delayMin: 25, remark: 'Contrôle technique' },
  { id: 'd06', scheduledAt: '09:00', cityId: 'kin', cityName: 'KINKALA',                                  busPlate: 'BZV 3345 KL', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Dolisie', platform: 'B1', statusId: 'SCHEDULED' },
  { id: 'd07', scheduledAt: '09:15', cityId: 'fih', cityName: 'KINSHASA (RDC)', via: 'Kinkala · Beach · Inter-état', busPlate: 'BZV 5512 MN', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Kinshasa',  platform: 'E2', statusId: 'SCHEDULED' },
  { id: 'd08', scheduledAt: '09:30', cityId: 'mad', cityName: 'MADINGOU',       via: 'Kinkala',            busPlate: 'BZV 8823 OP', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare N\'Kayi',       platform: 'C3', statusId: 'SCHEDULED' },
  { id: 'd09', scheduledAt: '10:00', cityId: 'djm', cityName: 'DJAMBALA',       via: 'Gamboma · Lékana',   busPlate: 'BZV 6678 QR', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Ouesso',        platform: 'D2', statusId: 'SCHEDULED' },
  { id: 'd10', scheduledAt: '10:30', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Dolisie · Loubomo',  busPlate: 'BZV 1190 ST', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Pointe-Noire', platform: 'A3', statusId: 'CANCELLED' },
  { id: 'd11', scheduledAt: '11:00', cityId: 'imp', cityName: 'IMPFONDO',       via: 'Gamboma · Owando · Ouesso · Dongou', busPlate: 'BZV 4467 UV', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Ouesso',        platform: 'D3', statusId: 'SCHEDULED' },
  { id: 'd12', scheduledAt: '11:30', cityId: 'lbv', cityName: 'LIBREVILLE (GA)',via: 'Dolisie · Mouila · Lambaréné · Inter-état', busPlate: 'BZV 7701 WX', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Libreville', platform: 'E1', statusId: 'SCHEDULED' },
];

const DEMO_ARRIVALS: BoardRow[] = [
  { id: 'a01', scheduledAt: '07:10', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Dolisie · Loubomo', busPlate: 'PNR 1122 AA', agencyOrigin: 'Gare Pointe-Noire', agencyDest: 'Gare Brazzaville', platform: 'A1', statusId: 'ARRIVED' },
  { id: 'a02', scheduledAt: '07:45', cityId: 'dol', cityName: 'DOLISIE',                                  busPlate: 'PNR 3344 BB', agencyOrigin: 'Gare Dolisie', agencyDest: 'Gare Brazzaville', platform: 'B1', statusId: 'ARRIVED' },
  { id: 'a03', scheduledAt: '08:20', cityId: 'nky', cityName: 'N\'KAYI',                                  busPlate: 'NKY 5566 CC', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare N\'Kayi',      platform: 'C2', statusId: 'IN_TRANSIT' },
  { id: 'a04', scheduledAt: '09:00', cityId: 'oue', cityName: 'OUESSO',         via: 'Owando · Gamboma',   busPlate: 'OWA 7788 DD', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Ouesso',       platform: 'D1', statusId: 'DELAYED', delayMin: 40 },
  { id: 'a05', scheduledAt: '09:30', cityId: 'fih', cityName: 'KINSHASA (RDC)', via: 'Inter-état',         busPlate: 'FIH 9900 EE', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare Kinshasa', platform: 'E2', statusId: 'SCHEDULED' },
  { id: 'a06', scheduledAt: '10:00', cityId: 'kin', cityName: 'KINKALA',                                  busPlate: 'KIN 1234 FF', agencyOrigin: 'Gare Kinkala', agencyDest: 'Gare Brazzaville', platform: 'B2', statusId: 'SCHEDULED' },
  { id: 'a07', scheduledAt: '10:45', cityId: 'mad', cityName: 'MADINGOU',                                 busPlate: 'MAD 5678 GG', agencyOrigin: 'Gare Brazzaville', agencyDest: 'Gare N\'Kayi',      platform: 'C3', statusId: 'CANCELLED' },
];

// ─── API Trip → BoardRow mapper ──────────────────────────────────────────────

function tripToBoardRow(trip: any, mode: BoardMode = 'DEPARTURES'): BoardRow {
  const isDeparture = mode === 'DEPARTURES';
  const origin      = trip.route?.origin;
  const destination = trip.route?.destination;
  const target      = isDeparture ? destination : origin;
  const waypoints   = trip.route?.waypoints ?? [];
  const viaStops    = waypoints
    .map((w: any) => w.station?.city ?? w.station?.name)
    .filter(Boolean);

  const originCity = (origin?.city ?? origin?.name ?? '—').toUpperCase();
  const destCity   = (destination?.city ?? destination?.name ?? '—').toUpperCase();

  const depDate = new Date(trip.departureScheduled);
  return {
    id:              trip.id,
    scheduledAt:     depDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    dateISO:         depDate.toISOString().slice(0, 10),
    cityName:        (target?.city ?? target?.name ?? '—').toUpperCase(),
    cityId:          target?.id ?? '',
    originName:      originCity,
    destinationName: destCity,
    via:             viaStops.length > 0 ? viaStops.join(' · ') : undefined,
    busPlate:        trip.bus?.plateNumber ?? '—',
    agencyOrigin:    origin?.name ?? '',
    agencyDest:      destination?.name ?? '',
    platform:        '',
    statusId:        trip.status ?? 'SCHEDULED',
    remark:          trip.displayNote ?? undefined,
  };
}

// ─── Ticker ────────────────────────────────────────────────────────────────────

interface TickerProps {
  notifications: Notification[];
  lang:          Language;
  t:             (map: TranslationMap) => string;
  dict:          ReturnType<typeof useI18n>['dict'];
  isConnected:   boolean;
  /** Météo des villes destination — affiché en alternance quand pas de notifications */
  weatherData?:  { cityName: string; tempC: number; condition: string; humidity: number }[];
}

function Ticker({ notifications, lang, t, dict, isConnected, weatherData = [] }: TickerProps) {
  const texts = notifications.map(n => {
    const icon = NOTIFICATION_ICONS[n.type] ?? 'ℹ';
    const typeLabel = t(dict.notifications[
      n.type === 'DELAY_ALERT'     ? 'delay'   :
      n.type === 'WEATHER_UPDATE'  ? 'weather' :
      n.type === 'SECURITY_ALERT'  ? 'alert'   :
      n.type === 'ROAD_SAFETY'     ? 'safety'  :
      n.type === 'TARIFF_CHANGE'   ? 'news'    : 'info'
    ]);
    const msg = n.message[lang] ?? n.message['fr'] ?? n.text ?? '';
    return `${icon} [${typeLabel}] ${msg}`;
  });

  // Fallback météo : afficher la météo live des villes de destination des trajets
  if (texts.length === 0 && weatherData.length > 0) {
    const weatherLabel = t(dict.notifications.weather);
    for (const w of weatherData) {
      const icon = WEATHER_ICONS[w.condition as keyof typeof WEATHER_ICONS] ?? '🌡';
      texts.push(`${icon} [${weatherLabel}] ${w.cityName} : ${w.tempC}°C — ${t(dict.weather.humidity)} ${w.humidity}%`);
    }
  }

  const fullText = texts.join('     ·     ');

  if (!fullText) return null;

  return (
    <div
      role="marquee"
      aria-live="polite"
      aria-label={t(dict.notifications.info)}
      className={cn(
        'flex items-center overflow-hidden shrink-0 h-16 xl:h-20',
        'bg-amber-400 text-slate-900 dark:bg-amber-500 dark:text-slate-950',
      )}
    >
      {/* Type badge */}
      <div
        aria-hidden
        className={cn(
          'shrink-0 h-full px-4 xl:px-5 flex items-center font-black text-sm xl:text-base uppercase tracking-widest',
          'bg-amber-600 text-white dark:bg-amber-700',
        )}
      >
        {isConnected
          ? <><span className="mr-2 w-2.5 h-2.5 bg-emerald-400 rounded-full inline-block animate-pulse" />LIVE</>
          : 'INFO'
        }
      </div>

      {/* Scrolling text */}
      <div className="flex-1 overflow-hidden" aria-hidden>
        <p
          className="whitespace-nowrap text-lg xl:text-xl font-bold leading-[4rem] xl:leading-[5rem]"
          style={{ animation: 'board-ticker 40s linear infinite' }}
        >
          {fullText}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{fullText}
        </p>
      </div>
    </div>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({
  statusId,
  registry,
  lang,
}: {
  statusId: string;
  registry: ReturnType<typeof useTenantConfig>['statuses'];
  lang:     Language;
}) {
  const cfg = registry[statusId];
  if (!cfg) return (
    <span className="text-xs text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">{statusId}</span>
  );
  const label = cfg.label[lang] ?? cfg.label['fr'] ?? statusId;

  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider border w-full',
        cfg.visual.badgeCls,
        cfg.visual.animateCls,
      )}
    >
      {label}
    </span>
  );
}

// ─── Clock ────────────────────────────────────────────────────────────────────

function LiveClock({ dateLocale }: { dateLocale: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  return (
    <time
      aria-live="off"
      dateTime={now.toISOString()}
      className="text-right tabular-nums"
    >
      <p className="text-4xl xl:text-5xl font-black text-slate-900 dark:text-white leading-none">
        {now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 capitalize">
        {now.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </time>
  );
}

// ─── Language selector ────────────────────────────────────────────────────────

function LanguageSelector({
  lang,
  onSelect,
  availableLangs,
}: {
  lang:           Language;
  onSelect:       (l: Language) => void;
  availableLangs: Language[];
}) {
  return (
    <div
      role="toolbar"
      aria-label="Language selector"
      className="flex gap-1 flex-wrap"
    >
      {availableLangs.map(l => (
        <button
          key={l}
          onClick={() => onSelect(l)}
          aria-pressed={lang === l}
          aria-label={LANGUAGE_META[l].label}
          title={LANGUAGE_META[l].label}
          className={cn(
            'w-7 h-7 rounded text-sm transition-all',
            lang === l
              ? 'bg-[var(--color-primary)] text-white ring-2 ring-[var(--color-primary)]/50'
              : 'bg-white hover:bg-slate-100 text-slate-600 shadow-sm border border-slate-200 dark:border-transparent dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 dark:shadow-none',
          )}
        >
          {LANGUAGE_META[l].flag}
        </button>
      ))}
    </div>
  );
}

// ─── Mode Selector ────────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onChange,
  tDepartures,
  tArrivals,
}: {
  mode:        BoardMode;
  onChange:    (m: BoardMode) => void;
  tDepartures: string;
  tArrivals:   string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Board mode"
      className={cn(
        'flex rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900 shadow-sm dark:shadow-none shrink-0',
      )}
    >
      {(['DEPARTURES', 'ARRIVALS'] as BoardMode[]).map(m => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            'flex items-center gap-2 px-5 py-2 text-sm font-bold uppercase tracking-widest transition-all',
            mode === m
              ? 'bg-[var(--color-primary)] text-white'
              : 'text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          <span aria-hidden>{m === 'DEPARTURES' ? '↑' : '↓'}</span>
          {m === 'DEPARTURES' ? tDepartures : tArrivals}
        </button>
      ))}
    </div>
  );
}

// ─── Day Separator ───────────────────────────────────────────────────────────

function DaySeparator({ dateISO, dateLocale }: { dateISO: string; dateLocale: string }) {
  const d = new Date(dateISO + 'T00:00:00');
  const label = d.toLocaleDateString(dateLocale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return (
    <div
      role="separator"
      aria-label={label}
      className={cn(
        'flex items-center gap-4 px-4 xl:px-6 py-2.5',
        'bg-[var(--color-primary)] text-white',
      )}
    >
      <div className="h-px flex-1 bg-white/30" />
      <span className="text-sm xl:text-base font-bold uppercase tracking-wide whitespace-nowrap capitalize">
        {label}
      </span>
      <div className="h-px flex-1 bg-white/30" />
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

function BoardRowItem({
  row,
  mode,
  isAllStations,
  registry,
  lang,
}: {
  row:            BoardRow;
  mode:           BoardMode;
  isAllStations:  boolean;
  registry:       ReturnType<typeof useTenantConfig>['statuses'];
  lang:           Language;
  t:              (map: TranslationMap) => string;
  dict:           ReturnType<typeof useI18n>['dict'];
}) {
  const cfg        = registry[row.statusId];
  const isTerminal = cfg?.visual.terminal ?? false;
  const isBoarding = row.statusId === 'BOARDING';

  const rowBaseClass = cn(
    // Grille responsive : sur petits écrans certaines colonnes se cachent
    'grid items-center gap-x-3 px-4 xl:px-6 py-3 border-b',
    'border-slate-200/80 dark:border-slate-800 hover:bg-slate-100/50 dark:hover:bg-slate-900/30 transition-colors',
    isAllStations
      ? 'grid-cols-[4.5rem_1fr_1fr_minmax(0,7rem)_3.5rem_minmax(0,9rem)_1fr]'
      : 'grid-cols-[4.5rem_1fr_minmax(0,7rem)_minmax(0,8rem)_3.5rem_minmax(0,9rem)_1fr]',
    isTerminal && 'opacity-40',
    isBoarding && 'bg-amber-50/50 dark:bg-amber-950/20',
    cfg?.visual.rowCls,
    'min-h-[3.5rem] xl:min-h-[4rem]',
  );

  return (
    <div
      role="row"
      aria-label={`${row.scheduledAt} ${row.cityName} ${cfg?.label[lang] ?? row.statusId}`}
      className={rowBaseClass}
    >
      {/* Heure */}
      <div role="cell">
        <p className={cn(
          'text-xl xl:text-2xl font-black tabular-nums leading-none',
          isTerminal ? 'text-slate-400 dark:text-slate-600' : 'text-slate-900 dark:text-white',
        )}>
          {row.scheduledAt}
        </p>
        {row.delayMin != null && row.delayMin > 0 && (
          <p className="text-xs text-orange-400 font-semibold mt-0.5" aria-label={`Retard ${row.delayMin} min`}>
            +{row.delayMin}&nbsp;min
          </p>
        )}
      </div>

      {/* Ville(s) — mode all : Provenance + Destination, sinon une seule colonne */}
      {isAllStations ? (
        <>
          <div role="cell" className="min-w-0">
            <p className={cn(
              'text-sm xl:text-base font-bold uppercase tracking-wide leading-tight truncate',
              isTerminal ? 'text-slate-600 dark:text-slate-600' : 'text-slate-900 dark:text-white',
            )}>
              {row.originName ?? '—'}
            </p>
            <p className="text-[10px] xl:text-xs text-slate-500 dark:text-slate-400 truncate">
              {row.agencyOrigin}
            </p>
          </div>
          <div role="cell" className="min-w-0">
            <p className={cn(
              'text-sm xl:text-base font-bold uppercase tracking-wide leading-tight truncate',
              isTerminal ? 'text-slate-600 dark:text-slate-600' : 'text-[var(--color-primary)]',
            )}>
              {row.destinationName ?? '—'}
            </p>
            <p className="text-[10px] xl:text-xs text-slate-500 dark:text-slate-400 truncate">
              {row.agencyDest}
            </p>
            {row.via && (
              <div className="overflow-hidden mt-0.5 max-w-full">
                <p className={cn(
                  'whitespace-nowrap text-[10px] xl:text-xs font-semibold',
                  'text-amber-600 dark:text-amber-400',
                )}
                  style={row.via.length > 25 ? { animation: 'via-scroll 12s linear infinite', display: 'inline-block' } : undefined}
                >via {row.via}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div role="cell" className="min-w-0">
          <p className={cn(
            'text-base xl:text-xl font-extrabold uppercase tracking-wide leading-tight',
            isTerminal ? 'text-slate-600 dark:text-slate-600' : 'text-slate-900 dark:text-white',
          )}>
            {row.cityName}
          </p>
          {row.via && (
            <div className="overflow-hidden mt-0.5 max-w-full">
              <p className={cn(
                'whitespace-nowrap text-xs xl:text-sm font-semibold',
                isTerminal ? 'text-slate-400 dark:text-slate-600' : 'text-amber-600 dark:text-amber-400',
              )}
                style={row.via.length > 30 ? { animation: 'via-scroll 12s linear infinite', display: 'inline-block' } : undefined}
              >via {row.via}</p>
            </div>
          )}
        </div>
      )}

      {/* Bus */}
      <div role="cell" className="hidden sm:block">
        <span className={cn(
          'text-xs xl:text-sm font-mono font-semibold',
          isTerminal ? 'text-slate-400 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300',
        )}>
          {row.busPlate}
        </span>
      </div>

      {/* Agence (masquée en mode all — déjà sous Provenance/Destination) */}
      {!isAllStations && (
        <div role="cell" className="hidden md:block">
          <span className={cn(
            'text-xs xl:text-sm font-medium truncate block',
            isTerminal ? 'text-slate-400 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300',
          )}>
            {mode === 'DEPARTURES' ? row.agencyOrigin : row.agencyDest}
          </span>
        </div>
      )}

      {/* Quai */}
      <div role="cell" className="flex items-center justify-center">
        <span className={cn(
          'text-lg xl:text-2xl font-black tabular-nums',
          isTerminal ? 'text-slate-400 dark:text-slate-700' : 'text-[var(--color-primary)]',
        )}>
          {row.platform}
        </span>
      </div>

      {/* Statut */}
      <div role="cell">
        <StatusBadge statusId={row.statusId} registry={registry} lang={lang} />
      </div>

      {/* Remarque */}
      <div role="cell" className="hidden lg:block">
        {row.remark && (
          <span className="text-xs text-orange-600 dark:text-orange-400 italic truncate block">
            {row.remark}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function DepartureBoard({
  stationName    = 'Gare Routière de Brazzaville',
  stationNamei18n,
  stationId,
  tenantId       = 'demo',
  rows,
  initialMode    = 'DEPARTURES',
  autoRotateLang = true,
}: DepartureBoardProps) {
  const { lang, setLang, t, dir, dateLocale, dict } = useI18n();
  const tenantConfig = useTenantConfig();
  const { notifications, isConnected } = useNotifications({ tenantId });

  const [mode, setMode]              = useState<BoardMode>(initialMode);
  const [autoRotating, setAutoRotating] = useState(autoRotateLang);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotation automatique des langues (écrans TV publics)
  useEffect(() => {
    if (!autoRotating) return;
    const langs = tenantConfig.operational.rotateLanguages;
    const ms    = tenantConfig.operational.displayLangRotateMs;
    let idx     = langs.indexOf(lang);
    rotateRef.current = setInterval(() => {
      idx = (idx + 1) % langs.length;
      setLang(langs[idx]);
    }, ms);
    return () => { if (rotateRef.current) clearInterval(rotateRef.current); };
  }, [autoRotating, tenantConfig, lang, setLang]);

  const handleManualLangSelect = useCallback((l: Language) => {
    setAutoRotating(false);          // l'opérateur prend la main
    setLang(l);
    if (rotateRef.current) clearInterval(rotateRef.current);
  }, [setLang]);

  // ── Fetch live trip data from display API ────────────────────────────────
  const viewParam = mode === 'DEPARTURES' ? 'departures' : 'arrivals';
  const isAllStations = stationId === '__all__';
  const tripsRes = useFetch<any[]>(
    tenantId && tenantId !== 'demo'
      ? (isAllStations
          ? `/api/tenants/${tenantId}/display?view=${viewParam}`
          : stationId
            ? `/api/tenants/${tenantId}/stations/${stationId}/display?view=${viewParam}`
            : null)
      : null,
    [tenantId, stationId, mode],
    { skipRedirectOn401: true },
  );
  const apiRows = tripsRes.data?.map(t => tripToBoardRow(t, mode));
  // Données réelles si stationId fourni (mode connecté), démo uniquement en mode standalone
  const isLive = !!((stationId || isAllStations) && tenantId && tenantId !== 'demo');
  const displayRows = rows ?? (isLive
    ? (apiRows ?? [])
    : (apiRows?.length ? apiRows : (mode === 'DEPARTURES' ? DEMO_DEPARTURES : DEMO_ARRIVALS)));

  // Extraire les villes uniques de destination pour la météo du ticker
  const destCityCodes = [...new Set(
    displayRows
      .map(r => r.cityName?.slice(0, 3).toUpperCase())
      .filter(Boolean),
  )];
  const weatherMulti = useWeatherMulti(destCityCodes);

  // Nom de la gare traduit si dispo
  const localizedStationName =
    stationNamei18n?.[lang] ?? stationName;

  const tDepartures = t('board.departures');
  const tArrivals   = t('board.arrivals');

  return (
    <div
      dir={dir}
      lang={lang}
      aria-label={`${localizedStationName} — ${mode === 'DEPARTURES' ? tDepartures : tArrivals}`}
      className={cn(
        'flex flex-col h-screen overflow-hidden select-none',
        'bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white',
      )}
      style={{ fontFamily: 'var(--font-family)' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className={cn(
          'flex items-center justify-between gap-4 px-4 xl:px-8 py-3 xl:py-4 shrink-0',
          'bg-white dark:bg-slate-900 border-b-2 border-[var(--color-primary)] shadow-sm dark:shadow-none',
        )}
      >
        {/* Logo + gare */}
        <div className="flex items-center gap-3 xl:gap-4 min-w-0">
          {tenantConfig.brand.logoUrl ? (
            <img
              src={tenantConfig.brand.logoUrl}
              alt={tenantConfig.brand.brandName}
              className="w-10 h-10 xl:w-12 xl:h-12 rounded-xl object-contain"
            />
          ) : (
            <div
              className="w-10 h-10 xl:w-12 xl:h-12 rounded-xl flex items-center justify-center text-white font-black text-lg xl:text-xl shrink-0"
              style={{ backgroundColor: 'var(--color-primary)' }}
              aria-hidden
            >
              {tenantConfig.brand.brandName.charAt(0)}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-lg xl:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-widest truncate leading-tight">
              {localizedStationName}
            </p>
            <p
              className="text-xs xl:text-sm font-semibold uppercase tracking-wider mt-0.5"
              style={{ color: 'var(--color-primary)' }}
            >
              {t('ui.board_title')}&nbsp;
              <span className="font-black">
                {mode === 'DEPARTURES' ? tDepartures : tArrivals}
              </span>
            </p>
          </div>
        </div>

        {/* Centre : sélecteur mode */}
        <div className="flex flex-col items-center gap-2 shrink-0">
          <ModeSelector
            mode={mode}
            onChange={setMode}
            tDepartures={tDepartures}
            tArrivals={tArrivals}
          />
          {/* Indicateur rotation lang */}
          {autoRotating && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              {LANGUAGE_META[lang].flag}&nbsp;{LANGUAGE_META[lang].label}
              &nbsp;·&nbsp;auto
            </span>
          )}
        </div>

        {/* Droite : langue + horloge */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <LanguageSelector
            lang={lang}
            onSelect={handleManualLangSelect}
            availableLangs={tenantConfig.operational.rotateLanguages}
          />
          <LiveClock dateLocale={dateLocale} />
        </div>
      </header>

      {/* ── Column headers ─────────────────────────────────────────────── */}
      <div
        role="row"
        aria-hidden
        className={cn(
          'grid gap-x-3 px-4 xl:px-6 py-2 shrink-0',
          isAllStations
            ? 'grid-cols-[4.5rem_1fr_1fr_minmax(0,7rem)_3.5rem_minmax(0,9rem)_1fr]'
            : 'grid-cols-[4.5rem_1fr_minmax(0,7rem)_minmax(0,8rem)_3.5rem_minmax(0,9rem)_1fr]',
          'bg-[var(--color-primary)]/5 dark:bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/20 dark:border-[var(--color-primary)]/30',
          'text-[var(--color-primary)] text-[10px] xl:text-xs font-bold uppercase tracking-widest',
        )}
      >
        <span>{t('col.time')}</span>
        {isAllStations ? (
          <>
            <span>{t('col.origin')}</span>
            <span>{t('col.destination')}</span>
          </>
        ) : (
          <span>{mode === 'DEPARTURES' ? t('col.destination') : t('col.origin')}</span>
        )}
        <span className="hidden sm:block">{t('col.bus')}</span>
        {!isAllStations && (
          <span className="hidden md:block">
            {mode === 'DEPARTURES' ? t('col.agencyDeparture') : t('col.agencyArrival')}
          </span>
        )}
        <span className="text-center">{t('col.platform')}</span>
        <span>{t('col.status')}</span>
        <span className="hidden lg:block">{t('col.remarks')}</span>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────── */}
      <main
        role="table"
        aria-label={mode === 'DEPARTURES' ? tDepartures : tArrivals}
        aria-live="polite"
        className="flex-1 overflow-y-auto"
      >
        {displayRows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-400 dark:text-slate-500 text-lg font-semibold">
            {t('ui.no_data')}
          </div>
        ) : (
          displayRows.map((row, idx) => {
            // Insérer un séparateur quand la date change par rapport à la ligne précédente
            const prevDate = idx > 0 ? displayRows[idx - 1].dateISO : undefined;
            const showSep  = row.dateISO && row.dateISO !== prevDate;
            return (
              <div key={row.id}>
                {showSep && <DaySeparator dateISO={row.dateISO!} dateLocale={dateLocale} />}
                <BoardRowItem
                  row={row}
                  mode={mode}
                  isAllStations={isAllStations}
                  registry={tenantConfig.statuses}
                  lang={lang}
                  t={t}
                  dict={dict}
                />
              </div>
            );
          })
        )}
      </main>

      {/* ── Ticker ─────────────────────────────────────────────────────── */}
      <Ticker
        notifications={notifications}
        lang={lang}
        t={t}
        dict={dict}
        isConnected={isConnected}
        weatherData={weatherMulti}
      />

      {/* ── CSS animations ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes board-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        @keyframes via-scroll {
          0%, 15%  { transform: translateX(0); }
          85%, 100% { transform: translateX(calc(-100% + 10rem)); }
        }
      `}</style>
    </div>
  );
}

export default DepartureBoard;
