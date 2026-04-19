/**
 * QuaiScreen — Panneau d'information quai (TV/LED)
 *
 * Principes cardinaux :
 *   ✓ i18n 8 langues + rotation automatique
 *   ✓ Statuts via StatusRegistry
 *   ✓ Météo à destination via useWeather
 *   ✓ Notifications WebSocket dans le ticker
 *   ✓ Dark mode natif
 *   ✓ WCAG : aria-live, rôles, labels
 *   ✓ Responsive TV (4K ↔ terminal)
 */

import { useState, useEffect } from 'react';
import { cn, fmtDelay }        from '../../lib/utils';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useWeather, WEATHER_ICONS } from '../../lib/hooks/useWeather';
import { useNotifications, NOTIFICATION_ICONS } from '../../lib/hooks/useNotifications';
import { useTenantConfig }     from '../../providers/TenantConfigProvider';
import type { Language, TranslationMap } from '../../lib/i18n/types';
import { LANGUAGE_META }       from '../../lib/i18n/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface QuaiScreenProps {
  platform:          string;
  destination:       string;
  destinationCode?:  string;
  via?:              string;
  departureTime:     string;
  agencyName:        string;
  busPlate:          string;
  busModel:          string;
  driverName:        string;
  passengersConfirmed: number;
  /** Passagers scannés à l'entrée gare (CHECKED_IN + BOARDED). ≥ passengersOnBoard. */
  passengersCheckedIn?: number;
  passengersOnBoard:  number;
  capacity:          number;
  parcelsLoaded:     number;
  /** Total attendu de colis (loaded + pending). Permet de refléter "chargement terminé" quand loaded = total. */
  parcelsTotal?:     number;
  statusId:          string;
  departAt:          Date;
  /** Retard en minutes (calculé côté backend). 0 = à l'heure. */
  delayMinutes?:     number;
  tenantId?:         string;
  autoRotateLang?:   boolean;
}

// Statuts "pré-départ" : l'affichage passager mise sur les confirmés (jauge
// d'embarquement), pas sur les à-bord. Dès qu'on passe IN_PROGRESS, l'écran
// bascule sur les à-bord (jauge de capacité bus).
const PRE_DEPARTURE_STATUSES = new Set(['PLANNED', 'OPEN', 'BOARDING', 'BOARDING_COMPLETE']);
const IN_MOTION_STATUSES     = new Set(['IN_PROGRESS', 'IN_PROGRESS_PAUSED', 'IN_PROGRESS_DELAYED', 'IN_TRANSIT']);

// ─── Countdown ────────────────────────────────────────────────────────────────

function Countdown({ targetDate, statusId, delayMinutes, t }: {
  targetDate:   Date;
  statusId:     string;
  delayMinutes: number;
  t:   (m: string | TranslationMap) => string;
}) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, targetDate.getTime() - now.getTime());
  const h    = Math.floor(diff / 3_600_000);
  const m    = Math.floor((diff % 3_600_000) / 60_000);
  const s    = Math.floor((diff % 60_000) / 1_000);
  const pad  = (n: number) => String(n).padStart(2, '0');

  // Quand le compte est à zéro, le label "imminent" ne doit surtout pas
  // apparaître si on a accumulé du retard — sinon l'écran dit "DÉPART IMMINENT"
  // à côté d'un "+93min" qui se contredit. Hiérarchie :
  //   1. Trajet réellement parti  → "Parti"
  //   2. Retard accumulé           → "Retardé" (le badge porte le chiffre)
  //   3. Sinon                     → "Départ imminent"
  if (diff === 0) {
    if (IN_MOTION_STATUSES.has(statusId) || statusId === 'COMPLETED' || statusId === 'ARRIVED') {
      return (
        <span className="text-emerald-400 text-5xl xl:text-6xl font-black animate-pulse">
          {t('status.DEPARTED')}
        </span>
      );
    }
    if (delayMinutes > 0) {
      return (
        <span className="text-red-500 text-2xl xl:text-3xl font-black uppercase tracking-wide" aria-live="polite">
          {t('ui.delayed')}
        </span>
      );
    }
    return (
      <span className="text-amber-500 text-2xl xl:text-3xl font-black uppercase tracking-wide" aria-live="polite">
        {t('ui.imminent_departure')}
      </span>
    );
  }

  return (
    <span className="tabular-nums text-[var(--color-accent)]" aria-live="off">
      {h > 0 && <span>{pad(h)}<span className="text-slate-500 text-2xl xl:text-3xl">h</span></span>}
      <span className="text-4xl xl:text-5xl font-black">{pad(m)}</span>
      <span className="text-slate-500 text-2xl xl:text-3xl">m</span>
      <span className="text-4xl xl:text-5xl font-black">{pad(s)}</span>
      <span className="text-slate-500 text-2xl xl:text-3xl">s</span>
    </span>
  );
}

// ─── Delay badge ──────────────────────────────────────────────────────────────

function DelayBadge({ minutes, t, dict }: {
  minutes: number;
  t:       (m: string | TranslationMap) => string;
  dict:    ReturnType<typeof useI18n>['dict'];
}) {
  if (minutes <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${t(dict.notifications.delay)} ${minutes} min`}
      className="inline-flex items-center gap-1 rounded-lg px-3 py-1 text-base xl:text-lg font-black uppercase tracking-wide bg-red-500/15 text-red-500 dark:bg-red-500/20 dark:text-red-400 border border-red-500/40 animate-pulse tabular-nums"
    >
      <span aria-hidden>⏱</span>
      <span>{fmtDelay(minutes)}</span>
    </span>
  );
}

// ─── Occupancy bar ────────────────────────────────────────────────────────────

function OccupancyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const cls = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-[var(--color-primary)]';
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1"
    >
      <div className={cn('h-full rounded-full transition-all', cls)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Live Clock ───────────────────────────────────────────────────────────────

function LiveClock({ dateLocale }: { dateLocale: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1_000); return () => clearInterval(id); }, []);
  return (
    <time dateTime={now.toISOString()} className="tabular-nums text-right">
      <p className="text-3xl xl:text-4xl font-black text-slate-900 dark:text-white leading-none">
        {now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 capitalize">
        {now.toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' })}
      </p>
    </time>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function Ticker({ notifications, lang, t, dict }: {
  notifications: ReturnType<typeof useNotifications>['notifications'];
  lang:  Language;
  t:     (m: string | TranslationMap) => string;
  dict:  ReturnType<typeof useI18n>['dict'];
}) {
  const texts = notifications.map(n => {
    const icon = NOTIFICATION_ICONS[n.type] ?? 'ℹ';
    const msg  = n.message[lang] ?? n.message['fr'] ?? '';
    return `${icon} ${msg}`;
  });
  const text  = texts.join('     ·     ');
  if (!text) return null;
  return (
    <div
      role="marquee"
      aria-live="polite"
      className="flex items-center overflow-hidden shrink-0 h-16 xl:h-20 bg-amber-400 text-slate-900 dark:bg-amber-500 dark:text-slate-950"
    >
      <div className="shrink-0 px-4 xl:px-5 h-full flex items-center font-black text-sm xl:text-base uppercase tracking-widest bg-amber-600 text-white dark:bg-amber-700">
        {t(dict.notifications.info)}
      </div>
      <div className="flex-1 overflow-hidden" aria-hidden>
        <p className="whitespace-nowrap text-lg xl:text-xl font-bold leading-[4rem] xl:leading-[5rem]"
           style={{ animation: 'board-ticker 22s linear infinite' }}>
          {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
        </p>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

const DEMO_PROPS: QuaiScreenProps = {
  platform:            'A2',
  destination:         'POINTE-NOIRE',
  destinationCode:     'PNR',
  via:                 'Dolisie · Loubomo · Mossendjo',
  departureTime:       '08:00',
  agencyName:          'Transco',
  busPlate:            'BZV 7732 GH',
  busModel:            'Mercedes-Benz Actros',
  driverName:          'Jean-Baptiste Mavoungou',
  passengersConfirmed: 47,
  passengersCheckedIn: 42,
  passengersOnBoard:   31,
  capacity:            50,
  parcelsLoaded:       18,
  parcelsTotal:        20,
  statusId:            'BOARDING',
  departAt:            (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(),
  delayMinutes:        0,
};

export function QuaiScreen(props: Partial<QuaiScreenProps> = {}) {
  const p = { ...DEMO_PROPS, ...props };
  const { lang, setLang, t, dir, dateLocale, dict } = useI18n();
  const tenantConfig   = useTenantConfig();
  const { notifications } = useNotifications({ tenantId: p.tenantId ?? 'demo' });
  const { weather }    = useWeather(p.destinationCode);

  const statusCfg = tenantConfig.statuses[p.statusId];
  const delayMinutes = Math.max(0, p.delayMinutes ?? 0);
  const isPreDeparture = PRE_DEPARTURE_STATUSES.has(p.statusId);
  // Pendant l'embarquement, la "valeur forte" c'est le nombre de confirmés
  // qui ont un billet actif — c'est la cible à atteindre. Les à-bord sont
  // secondaires (progression d'embarquement). En roulant, c'est l'inverse.
  const bigValue    = isPreDeparture ? p.passengersConfirmed : p.passengersOnBoard;
  // Pendant l'embarquement on affiche les deux étapes du parcours passager :
  // "en gare" (checked-in) pour anticiper les absents, "à bord" pour l'état
  // courant. Sans le check-in on se retrouvait dans le cas réel du tenant :
  // 0 à bord juste avant le départ alors que tout le monde est déjà passé.
  const checkedIn   = Math.max(p.passengersCheckedIn ?? p.passengersOnBoard, p.passengersOnBoard);
  const smallLabel  = isPreDeparture
    ? `${checkedIn} ${t('ui.in_station').toLowerCase()} · ${p.passengersOnBoard} ${t('ui.on_board').toLowerCase()}`
    : `${p.passengersConfirmed} ${t('ui.confirmed').toLowerCase()}`;
  // La jauge se lit "combien ont déjà embarqué parmi les confirmés" — la
  // capacité du bus n'est jamais la référence ici : un bus de 60 places avec
  // 39 confirmés doit montrer 0/39 → 39/39 à l'embarquement, pas 0/60.
  const gaugeMax    = Math.max(p.passengersConfirmed, 1);
  const gaugeValue  = p.passengersOnBoard;

  // ── Bullet véhicule ────────────────────────────────────────────────────
  const busReady = Boolean(p.busPlate && p.busPlate !== '—');

  // ── Bullet colis ───────────────────────────────────────────────────────
  // Si parcelsTotal est inconnu (ancienne API) on retombe sur une vue "en
  // cours" par défaut. Sinon on distingue 3 états pour que l'écran reflète
  // l'état réel du chargement au lieu d'afficher "Chargement" en permanence.
  const parcelsTotal = p.parcelsTotal ?? 0;
  type ParcelState = { labelKey: string; dotCls: string; textCls: string };
  const parcelState: ParcelState = parcelsTotal === 0
    ? { labelKey: 'ui.no_parcels',         dotCls: 'bg-slate-400',   textCls: 'text-slate-400' }
    : p.parcelsLoaded >= parcelsTotal
      ? { labelKey: 'ui.loading_complete',   dotCls: 'bg-emerald-400', textCls: 'text-emerald-400' }
      : { labelKey: 'ui.loading_in_progress', dotCls: 'bg-amber-400',   textCls: 'text-amber-400' };

  // Injecte un message de retard en tête du ticker si delayMinutes > 0. On
  // fabrique une Notification synthétique avec les 8 locales pour rester
  // cohérent avec le flux WebSocket (pas de chaîne hardcodée côté ticker).
  const delayNotifications = delayMinutes > 0
    ? [{
        id: `local-delay-${p.statusId}`,
        type: 'DELAY_ALERT' as const,
        priority: 1 as const,
        createdAt: new Date(),
        message: {
          fr:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          en:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          es:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          pt:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          ar:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} د`,
          wo:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          ln:  `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
          ktu: `${t(dict.notifications.delay)} — ${p.destination} ${p.departureTime} · +${delayMinutes} min`,
        },
      }]
    : [];
  const tickerNotifications = [...delayNotifications, ...notifications];

  // Rotation auto lang
  useEffect(() => {
    if (!p.autoRotateLang) return;
    const langs = tenantConfig.operational.rotateLanguages;
    const ms    = tenantConfig.operational.displayLangRotateMs;
    let idx     = langs.indexOf(lang);
    const id    = setInterval(() => { idx = (idx + 1) % langs.length; setLang(langs[idx]); }, ms);
    return () => clearInterval(id);
  }, [p.autoRotateLang, tenantConfig, lang, setLang]);

  return (
    <div
      dir={dir}
      lang={lang}
      aria-label={`Quai ${p.platform} — ${p.destination}`}
      className="flex flex-col h-screen overflow-hidden select-none bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
      style={{ fontFamily: 'var(--font-family)' }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={cn(
        'flex items-center justify-between gap-4 px-6 xl:px-8 py-4 xl:py-5 shrink-0',
        'bg-white dark:bg-slate-900 border-b-2 border-[var(--color-primary)] shadow-sm dark:shadow-none',
      )}>
        {/* Numéro de quai */}
        <div className="flex items-center gap-4 xl:gap-6">
          <div
            className={cn(
              'flex flex-col items-center justify-center rounded-2xl',
              'w-24 h-20 xl:w-28 xl:h-24 shadow-lg shrink-0',
            )}
            style={{ backgroundColor: 'var(--color-primary)' }}
            aria-label={`${t('ui.platform_label')} ${p.platform}`}
          >
            <p className="text-xs font-bold uppercase tracking-widest text-white/70">
              {t('ui.platform_label')}
            </p>
            <p className="text-5xl xl:text-6xl font-black text-white leading-none">{p.platform}</p>
          </div>

          {/* Badge statut */}
          <div>
            {statusCfg && (
              <span
                role="status"
                aria-live="polite"
                className={cn(
                  'inline-flex items-center justify-center rounded-xl px-5 py-2.5',
                  'text-xl xl:text-2xl font-black uppercase tracking-widest border-2',
                  statusCfg.visual.badgeCls,
                  statusCfg.visual.animateCls,
                )}
              >
                {statusCfg.label[lang] ?? statusCfg.label['fr']}
              </span>
            )}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                {t('ui.departure_in')}&nbsp;
                <Countdown
                  targetDate={p.departAt}
                  statusId={p.statusId}
                  delayMinutes={delayMinutes}
                  t={t}
                />
              </p>
              <DelayBadge minutes={delayMinutes} t={t} dict={dict} />
            </div>
          </div>
        </div>

        {/* Horloge + langue */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {tenantConfig.operational.rotateLanguages.map(l => (
              <span key={l} className="text-xs opacity-50 hover:opacity-100 cursor-pointer"
                    title={LANGUAGE_META[l].label}>{LANGUAGE_META[l].flag}</span>
            ))}
          </div>
          <LiveClock dateLocale={dateLocale} />
        </div>
      </header>

      {/* ── Destination ─────────────────────────────────────────── */}
      <section
        aria-label={t('col.destination')}
        className={cn(
          'px-6 xl:px-8 py-5 xl:py-6 shrink-0',
          'bg-gradient-to-r from-[var(--color-primary)]/5 dark:from-[var(--color-primary)]/10 to-transparent',
          'border-b border-slate-200 dark:border-slate-800',
        )}
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-primary)] mb-1">
              {t('col.destination')}
            </p>
            <p className="text-5xl xl:text-6xl font-black uppercase tracking-wide text-slate-900 dark:text-white">
              {p.destination}
            </p>
            {p.via && (
              <div className="overflow-hidden mt-1.5 max-w-[30rem]">
                <p
                  className={cn(
                    'whitespace-nowrap text-base xl:text-lg font-semibold',
                    'text-amber-600 dark:text-amber-400',
                  )}
                  style={p.via.length > 25
                    ? { animation: 'via-scroll 10s linear infinite', display: 'inline-block' }
                    : undefined
                  }
                >
                  via {p.via}
                </p>
              </div>
            )}
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            <div>
              <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('col.time')}</p>
              <p className="text-6xl xl:text-7xl font-black text-[var(--color-primary)] tabular-nums leading-none">
                {p.departureTime}
              </p>
            </div>
            {/* Météo destination mini */}
            {weather && (
              <div className="flex items-center gap-2 text-sm bg-slate-100 dark:bg-slate-800 rounded-xl px-3 py-1.5 border border-slate-200 dark:border-slate-700">
                <span>{WEATHER_ICONS[weather.condition]}</span>
                <span className="font-bold text-slate-900 dark:text-white">{weather.tempC}°C</span>
                <span className="text-slate-500 dark:text-slate-400">{weather.cityName}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 px-6 xl:px-8 py-5 flex-1">

        {/* Bus */}
        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{t('col.bus')}</p>
            <p className="text-xl xl:text-2xl font-black text-slate-900 dark:text-white font-mono">{p.busPlate}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.busModel}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className={cn('w-2 h-2 rounded-full', busReady ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400')} />
            <span className={cn('text-xs font-semibold', busReady ? 'text-emerald-400' : 'text-slate-400')}>
              {t(busReady ? 'ui.in_position' : 'ui.awaiting_bus')}
            </span>
          </div>
        </div>

        {/* Passagers */}
        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{t('col.passengers')}</p>
            {/* Pas de "/capacité" ici : afficher 39/60 entretient la confusion
                entre le nombre de confirmés et la capacité du bus (60 places).
                La jauge montre l'avancement d'embarquement côté confirmés. */}
            <p className="text-4xl xl:text-5xl font-black text-slate-900 dark:text-white tabular-nums">{bigValue}</p>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span>{smallLabel}</span>
              <span>{Math.round((gaugeValue / gaugeMax) * 100)}%</span>
            </div>
            <OccupancyBar value={gaugeValue} max={gaugeMax} />
          </div>
        </div>

        {/* Colis */}
        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{t('col.parcels')}</p>
            <p className="text-4xl xl:text-5xl font-black text-slate-900 dark:text-white tabular-nums">
              {p.parcelsLoaded}{parcelsTotal > 0 && <span className="text-xl text-slate-400 dark:text-slate-500">/{parcelsTotal}</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className={cn('w-2 h-2 rounded-full', parcelState.dotCls)} />
            <span className={cn('text-xs font-semibold', parcelState.textCls)}>
              {t(parcelState.labelKey)}
            </span>
          </div>
        </div>

        {/* Chauffeur */}
        <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{t('col.driver')}</p>
            <p className="text-xl xl:text-2xl font-bold text-slate-900 dark:text-white leading-tight">{p.driverName}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{p.agencyName}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-pulse" />
            <span className="text-xs font-semibold" style={{ color: 'var(--color-primary)' }}>
              {t('ui.on_board')}
            </span>
          </div>
        </div>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────── */}
      <Ticker notifications={tickerNotifications} lang={lang} t={t} dict={dict} />

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

export default QuaiScreen;
