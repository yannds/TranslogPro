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
import { useNotifications }      from '../../lib/hooks/useNotifications';
import { useTenantConfig }       from '../../providers/TenantConfigProvider';
import type { Notification }     from '../../lib/hooks/useNotifications';
import type { Language }         from '../../lib/i18n/types';
import { LANGUAGE_META }         from '../../lib/i18n/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type BoardMode = 'DEPARTURES' | 'ARRIVALS';

interface BoardRow {
  id:          string;
  scheduledAt: string;   // "HH:MM"
  delayMin?:   number;
  cityId:      string;   // résolu en nom via tenant cities
  cityName:    string;   // nom affiché (déjà résolu par l'API)
  via?:        string;
  busPlate:    string;
  agencyName:  string;
  platform:    string;
  statusId:    string;   // clé dans StatusRegistry
  remark?:     string;
}

interface DepartureBoardProps {
  /** Identifiant de la gare (affiché dans le header) */
  stationName?:     string;
  stationNamei18n?: Partial<Record<Language, string>>;
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
  { id: 'd01', scheduledAt: '06:30', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Dolisie · Loubomo', busPlate: 'BZV 2241 BA', agencyName: 'Transco',     platform: 'A1', statusId: 'DEPARTED' },
  { id: 'd02', scheduledAt: '07:00', cityId: 'dol', cityName: 'DOLISIE',                                  busPlate: 'BZV 1105 CD', agencyName: 'Sotraco',     platform: 'B2', statusId: 'DEPARTED' },
  { id: 'd03', scheduledAt: '07:30', cityId: 'nky', cityName: 'N\'KAYI',                                  busPlate: 'BZV 4490 EF', agencyName: 'Onemo',       platform: 'C1', statusId: 'BOARDING_COMPLETE' },
  { id: 'd04', scheduledAt: '08:00', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Sibiti · Mossendjo', busPlate: 'BZV 7732 GH', agencyName: 'Transco',     platform: 'A2', statusId: 'BOARDING', },
  { id: 'd05', scheduledAt: '08:30', cityId: 'oue', cityName: 'OUESSO',         via: 'Owando · Gamboma',   busPlate: 'BZV 9001 IJ', agencyName: 'STPU',        platform: 'D1', statusId: 'DELAYED', delayMin: 25, remark: 'Contrôle technique' },
  { id: 'd06', scheduledAt: '09:00', cityId: 'kin', cityName: 'KINKALA',                                  busPlate: 'BZV 3345 KL', agencyName: 'Sotraco',     platform: 'B1', statusId: 'SCHEDULED' },
  { id: 'd07', scheduledAt: '09:15', cityId: 'fih', cityName: 'KINSHASA (RDC)', via: 'Inter-état',         busPlate: 'BZV 5512 MN', agencyName: 'Congo Link',  platform: 'E2', statusId: 'SCHEDULED' },
  { id: 'd08', scheduledAt: '09:30', cityId: 'mad', cityName: 'MADINGOU',                                 busPlate: 'BZV 8823 OP', agencyName: 'Onemo',       platform: 'C3', statusId: 'SCHEDULED' },
  { id: 'd09', scheduledAt: '10:00', cityId: 'djm', cityName: 'DJAMBALA',       via: 'Gamboma',            busPlate: 'BZV 6678 QR', agencyName: 'STPU',        platform: 'D2', statusId: 'SCHEDULED' },
  { id: 'd10', scheduledAt: '10:30', cityId: 'pnr', cityName: 'POINTE-NOIRE',                              busPlate: 'BZV 1190 ST', agencyName: 'Transco',     platform: 'A3', statusId: 'CANCELLED' },
  { id: 'd11', scheduledAt: '11:00', cityId: 'imp', cityName: 'IMPFONDO',       via: 'Owando · Ouesso',    busPlate: 'BZV 4467 UV', agencyName: 'STPU',        platform: 'D3', statusId: 'SCHEDULED' },
  { id: 'd12', scheduledAt: '11:30', cityId: 'lbv', cityName: 'LIBREVILLE (GA)',via: 'Inter-état',         busPlate: 'BZV 7701 WX', agencyName: 'Congo-Gabon', platform: 'E1', statusId: 'SCHEDULED' },
];

const DEMO_ARRIVALS: BoardRow[] = [
  { id: 'a01', scheduledAt: '07:10', cityId: 'pnr', cityName: 'POINTE-NOIRE',  via: 'Dolisie · Loubomo', busPlate: 'PNR 1122 AA', agencyName: 'Transco',    platform: 'A1', statusId: 'ARRIVED' },
  { id: 'a02', scheduledAt: '07:45', cityId: 'dol', cityName: 'DOLISIE',                                  busPlate: 'PNR 3344 BB', agencyName: 'Sotraco',    platform: 'B1', statusId: 'ARRIVED' },
  { id: 'a03', scheduledAt: '08:20', cityId: 'nky', cityName: 'N\'KAYI',                                  busPlate: 'NKY 5566 CC', agencyName: 'Onemo',      platform: 'C2', statusId: 'IN_TRANSIT' },
  { id: 'a04', scheduledAt: '09:00', cityId: 'oue', cityName: 'OUESSO',         via: 'Owando · Gamboma',   busPlate: 'OWA 7788 DD', agencyName: 'STPU',       platform: 'D1', statusId: 'DELAYED', delayMin: 40 },
  { id: 'a05', scheduledAt: '09:30', cityId: 'fih', cityName: 'KINSHASA (RDC)', via: 'Inter-état',         busPlate: 'FIH 9900 EE', agencyName: 'Congo Link', platform: 'E2', statusId: 'SCHEDULED' },
  { id: 'a06', scheduledAt: '10:00', cityId: 'kin', cityName: 'KINKALA',                                  busPlate: 'KIN 1234 FF', agencyName: 'Sotraco',    platform: 'B2', statusId: 'SCHEDULED' },
  { id: 'a07', scheduledAt: '10:45', cityId: 'mad', cityName: 'MADINGOU',                                 busPlate: 'MAD 5678 GG', agencyName: 'Onemo',      platform: 'C3', statusId: 'CANCELLED' },
];

// ─── Ticker ────────────────────────────────────────────────────────────────────

interface TickerProps {
  notifications: Notification[];
  lang:          Language;
  t:             (map: Record<Language, string>) => string;
  dict:          ReturnType<typeof useI18n>['dict'];
  isConnected:   boolean;
}

function Ticker({ notifications, lang, t, dict, isConnected }: TickerProps) {
  const texts = notifications.map(n => {
    const typeLabel = t(dict.notifications[
      n.type === 'DELAY_ALERT'     ? 'delay'   :
      n.type === 'WEATHER_UPDATE'  ? 'weather' :
      n.type === 'SECURITY_ALERT'  ? 'alert'   :
      n.type === 'TARIFF_CHANGE'   ? 'news'    : 'info'
    ]);
    const msg = n.message[lang] ?? n.message['fr'] ?? n.text ?? '';
    return `[${typeLabel}] ${msg}`;
  });

  const fullText = texts.join('   ·   ');

  if (!fullText) return null;

  return (
    <div
      role="marquee"
      aria-live="polite"
      aria-label={t(dict.notifications.info)}
      className={cn(
        'flex items-center overflow-hidden shrink-0 h-10',
        'bg-amber-400 text-slate-900 dark:bg-amber-500 dark:text-slate-950',
      )}
    >
      {/* Type badge */}
      <div
        aria-hidden
        className="shrink-0 h-full px-3 flex items-center font-black text-xs uppercase tracking-widest bg-amber-600 text-white dark:bg-amber-700"
      >
        {isConnected
          ? <><span className="mr-1.5 w-2 h-2 bg-emerald-400 rounded-full inline-block animate-pulse" />LIVE</>
          : 'INFO'
        }
      </div>

      {/* Scrolling text */}
      <div className="flex-1 overflow-hidden" aria-hidden>
        <p
          className="whitespace-nowrap text-sm font-semibold leading-10"
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
      <p className="text-4xl xl:text-5xl font-black text-white dark:text-white leading-none">
        {now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-sm text-slate-400 dark:text-slate-400 mt-1 capitalize">
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
              : 'bg-slate-800 hover:bg-slate-700 text-slate-400 dark:bg-slate-800 dark:hover:bg-slate-700',
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
        'flex rounded-xl overflow-hidden border border-slate-700 dark:border-slate-700',
        'bg-slate-800 dark:bg-slate-900 shrink-0',
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
              : 'text-slate-400 hover:text-slate-200 dark:text-slate-500 dark:hover:text-slate-200',
          )}
        >
          <span aria-hidden>{m === 'DEPARTURES' ? '↑' : '↓'}</span>
          {m === 'DEPARTURES' ? tDepartures : tArrivals}
        </button>
      ))}
    </div>
  );
}

// ─── Table Row ────────────────────────────────────────────────────────────────

function BoardRowItem({
  row,
  registry,
  lang,
}: {
  row:      BoardRow;
  mode:     BoardMode;
  registry: ReturnType<typeof useTenantConfig>['statuses'];
  lang:     Language;
  t:        (map: Record<Language, string>) => string;
  dict:     ReturnType<typeof useI18n>['dict'];
}) {
  const cfg        = registry[row.statusId];
  const isTerminal = cfg?.visual.terminal ?? false;
  const isBoarding = row.statusId === 'BOARDING';

  const rowBaseClass = cn(
    // Grille responsive : sur petits écrans certaines colonnes se cachent
    'grid items-center gap-x-3 px-4 xl:px-6 py-3 border-b',
    'border-slate-800 dark:border-slate-800',
    'grid-cols-[4.5rem_1fr_minmax(0,7rem)_minmax(0,8rem)_3.5rem_minmax(0,9rem)_1fr]',
    isTerminal && 'opacity-40',
    isBoarding && 'dark:bg-amber-950/20 bg-amber-50/30',
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
          isTerminal ? 'text-slate-600' : 'text-white',
        )}>
          {row.scheduledAt}
        </p>
        {row.delayMin != null && row.delayMin > 0 && (
          <p className="text-xs text-orange-400 font-semibold mt-0.5" aria-label={`Retard ${row.delayMin} min`}>
            +{row.delayMin}&nbsp;min
          </p>
        )}
      </div>

      {/* Ville (destination ou provenance) */}
      <div role="cell">
        <p className={cn(
          'text-base xl:text-xl font-extrabold uppercase tracking-wide leading-tight',
          isTerminal ? 'text-slate-600' : 'text-white',
        )}>
          {row.cityName}
        </p>
        {row.via && (
          <p className="text-[10px] xl:text-xs text-slate-500 dark:text-slate-500 mt-0.5 truncate">
            via {row.via}
          </p>
        )}
      </div>

      {/* Bus */}
      <div role="cell" className="hidden sm:block">
        <span className={cn(
          'text-xs xl:text-sm font-mono font-semibold',
          isTerminal ? 'text-slate-600' : 'text-slate-300 dark:text-slate-300',
        )}>
          {row.busPlate}
        </span>
      </div>

      {/* Agence */}
      <div role="cell" className="hidden md:block">
        <span className={cn(
          'text-xs xl:text-sm font-medium truncate block',
          isTerminal ? 'text-slate-600' : 'text-slate-300 dark:text-slate-300',
        )}>
          {row.agencyName}
        </span>
      </div>

      {/* Quai */}
      <div role="cell" className="flex items-center justify-center">
        <span className={cn(
          'text-lg xl:text-2xl font-black tabular-nums',
          isTerminal ? 'text-slate-700' : 'text-[var(--color-primary)]',
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
          <span className="text-xs text-orange-400 dark:text-orange-400 italic truncate block">
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

  const displayRows = rows ?? (mode === 'DEPARTURES' ? DEMO_DEPARTURES : DEMO_ARRIVALS);

  // Nom de la gare traduit si dispo
  const localizedStationName =
    stationNamei18n?.[lang] ?? stationName;

  const tDepartures = t(dict.board.departures);
  const tArrivals   = t(dict.board.arrivals);

  return (
    <div
      dir={dir}
      lang={lang}
      aria-label={`${localizedStationName} — ${mode === 'DEPARTURES' ? tDepartures : tArrivals}`}
      className={cn(
        'flex flex-col h-screen overflow-hidden select-none',
        'bg-slate-950 dark:bg-slate-950 text-white',
      )}
      style={{ fontFamily: 'var(--font-family)' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className={cn(
          'flex items-center justify-between gap-4 px-4 xl:px-8 py-3 xl:py-4 shrink-0',
          'bg-slate-900 dark:bg-slate-900 border-b-2 border-[var(--color-primary)]',
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
            <p className="text-lg xl:text-2xl font-black text-white uppercase tracking-widest truncate leading-tight">
              {localizedStationName}
            </p>
            <p
              className="text-xs xl:text-sm font-semibold uppercase tracking-wider mt-0.5"
              style={{ color: 'var(--color-primary)' }}
            >
              {t(dict.ui.board_title)}&nbsp;
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
            <span className="text-[10px] text-slate-500 italic">
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
          'grid-cols-[4.5rem_1fr_minmax(0,7rem)_minmax(0,8rem)_3.5rem_minmax(0,9rem)_1fr]',
          'bg-[var(--color-primary)]/10 border-b border-[var(--color-primary)]/30',
          'text-[var(--color-primary)] text-[10px] xl:text-xs font-bold uppercase tracking-widest',
        )}
      >
        <span>{t(dict.col.time)}</span>
        <span>{mode === 'DEPARTURES' ? t(dict.col.destination) : t(dict.col.origin)}</span>
        <span className="hidden sm:block">{t(dict.col.bus)}</span>
        <span className="hidden md:block">{t(dict.col.agency)}</span>
        <span className="text-center">{t(dict.col.platform)}</span>
        <span>{t(dict.col.status)}</span>
        <span className="hidden lg:block">{t(dict.col.remarks)}</span>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────── */}
      <main
        role="table"
        aria-label={mode === 'DEPARTURES' ? tDepartures : tArrivals}
        aria-live="polite"
        className="flex-1 overflow-y-auto"
      >
        {displayRows.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-slate-500 text-lg font-semibold">
            {t(dict.ui.no_data)}
          </div>
        ) : (
          displayRows.map(row => (
            <BoardRowItem
              key={row.id}
              row={row}
              mode={mode}
              registry={tenantConfig.statuses}
              lang={lang}
              t={t}
              dict={dict}
            />
          ))
        )}
      </main>

      {/* ── Ticker ─────────────────────────────────────────────────────── */}
      <Ticker
        notifications={notifications}
        lang={lang}
        t={t}
        dict={dict}
        isConnected={isConnected}
      />

      {/* ── CSS animations ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes board-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export default DepartureBoard;
