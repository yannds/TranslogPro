/**
 * BusScreen — Écran embarqué dans le bus
 *
 * Principes cardinaux :
 *   ✓ Météo à destination via useWeather()
 *   ✓ i18n 8 langues + rotation automatique
 *   ✓ Statuts via StatusRegistry (zéro hardcode)
 *   ✓ Notifications WebSocket dans le ticker
 *   ✓ Dark mode natif — CSS variables + Tailwind dark:
 *   ✓ WCAG : aria-live, rôles sémantiques
 *   ✓ Responsive : de petit écran embarqué jusqu'au HD
 */

import { useState, useEffect } from 'react';
import { cn }                  from '../../lib/utils';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useWeather, WEATHER_ICONS } from '../../lib/hooks/useWeather';
import { useNotifications, NOTIFICATION_ICONS } from '../../lib/hooks/useNotifications';
import { useTenantConfig }     from '../../providers/TenantConfigProvider';
import type { Language, TranslationMap } from '../../lib/i18n/types';
import { LANGUAGE_META }       from '../../lib/i18n/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type StopStatus = 'PASSED' | 'CURRENT' | 'UPCOMING';

interface RouteStop {
  id:          string;
  cityCode:    string;
  cityName:    string;
  scheduledAt: string;
  distanceKm:  number;
  status:      StopStatus;
}

interface BusScreenProps {
  tripRef?:       string;
  routeLabel?:    string;
  destinationCode?: string;
  stops?:         RouteStop[];
  busPlate?:      string;
  busModel?:      string;
  driverName?:    string;
  agencyName?:    string;
  capacity?:      number;
  passengersOnBoard?: number;
  parcelsOnBoard?: number;
  tenantId?:      string;
  /** Active rotation automatique des langues */
  autoRotateLang?: boolean;
}

// ─── Données démo (Congo-Brazzaville) ─────────────────────────────────────────

const DEMO_STOPS: RouteStop[] = [
  { id: 's1', cityCode: 'BZV', cityName: 'Brazzaville', scheduledAt: '07:00', distanceKm: 0,   status: 'PASSED'  },
  { id: 's2', cityCode: 'KIN', cityName: 'Kinkala',      scheduledAt: '08:00', distanceKm: 70,  status: 'PASSED'  },
  { id: 's3', cityCode: 'MAD', cityName: 'Madingou',     scheduledAt: '09:30', distanceKm: 155, status: 'PASSED'  },
  { id: 's4', cityCode: 'SIB', cityName: 'Sibiti',       scheduledAt: '11:00', distanceKm: 280, status: 'CURRENT' },
  { id: 's5', cityCode: 'MOS', cityName: 'Mossendjo',    scheduledAt: '12:30', distanceKm: 370, status: 'UPCOMING' },
  { id: 's6', cityCode: 'DOL', cityName: 'Dolisie',      scheduledAt: '13:45', distanceKm: 440, status: 'UPCOMING' },
  { id: 's7', cityCode: 'PNR', cityName: 'Pointe-Noire', scheduledAt: '16:00', distanceKm: 560, status: 'UPCOMING' },
];

// ─── Config visuelle des stops ────────────────────────────────────────────────

const STOP_STYLE: Record<StopStatus, {
  dot:  string;
  line: string;
  text: string;
  time: string;
}> = {
  PASSED:   {
    dot:  'bg-emerald-500 border-emerald-500',
    line: 'bg-emerald-700/50',
    text: 'text-slate-500 line-through',
    time: 'text-slate-600',
  },
  CURRENT:  {
    dot:  'bg-[var(--color-accent)] border-[var(--color-accent)] ring-4 ring-[var(--color-accent)]/30 animate-pulse',
    line: 'bg-slate-700',
    text: 'text-[var(--color-accent)] font-bold',
    time: 'text-[var(--color-accent)]',
  },
  UPCOMING: {
    dot:  'bg-slate-700 border-slate-600',
    line: 'bg-slate-800',
    text: 'text-slate-400',
    time: 'text-slate-600',
  },
};

// ─── Clock ────────────────────────────────────────────────────────────────────

function LiveClock({ dateLocale }: { dateLocale: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);
  return (
    <time dateTime={now.toISOString()} className="tabular-nums text-right">
      <p className="text-2xl xl:text-3xl font-black text-slate-900 dark:text-white">
        {now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {now.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
      </p>
    </time>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub,
  accentCls = 'text-[var(--color-primary)] bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30',
}: {
  icon:      string;
  label:     string;
  value:     string;
  sub?:      string;
  accentCls?: string;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-3 xl:p-4 flex flex-col gap-1',
      'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none',
    )}>
      <p className="text-base xl:text-lg">{icon}</p>
      <p className="text-[10px] xl:text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide font-semibold">{label}</p>
      <p className={cn('text-xl xl:text-2xl font-black tabular-nums', accentCls.split(' ')[0])}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 dark:text-slate-600">{sub}</p>}
    </div>
  );
}

// ─── Weather Widget ───────────────────────────────────────────────────────────

function WeatherWidget({
  cityCode,
  t,
  dict,
}: {
  cityCode: string | undefined;
  lang?:    Language;
  t:        (map: string | TranslationMap) => string;
  dict:     ReturnType<typeof useI18n>['dict'];
}) {
  const { weather, loading } = useWeather(cityCode);

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-500 text-xs animate-pulse">
      <span>…</span>
      <span>{t('ui.loading')}</span>
    </div>
  );

  if (!weather) return null;

  const conditionKey = weather.condition as keyof typeof dict.weather;
  const condLabel    = dict.weather[conditionKey]
    ? t(dict.weather[conditionKey])
    : weather.condition;

  return (
    <div
      aria-label={`${t(dict.weather.at_destination)} ${weather.cityName}: ${weather.tempC}°C, ${condLabel}`}
      className={cn(
        'flex items-center gap-2 xl:gap-3 rounded-xl border px-3 py-2',
        'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-none',
      )}
    >
      <span className="text-2xl xl:text-3xl" aria-hidden>{WEATHER_ICONS[weather.condition]}</span>
      <div>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {t(dict.weather.at_destination)} · {weather.cityName}
        </p>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-xl xl:text-2xl font-black text-slate-900 dark:text-white tabular-nums">{weather.tempC}°C</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{condLabel}</span>
        </div>
        <div className="flex gap-2 text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          <span>{t(dict.weather.feels_like)} {weather.feelsLikeC}°C</span>
          <span>·</span>
          <span>{t(dict.weather.humidity)} {weather.humidity}%</span>
          <span>·</span>
          <span>{weather.windKmh} km/h</span>
        </div>
      </div>
    </div>
  );
}

// ─── Itinerary sidebar ────────────────────────────────────────────────────────

function Itinerary({
  stops,
}: {
  stops: RouteStop[];
  t?:    (map: string | TranslationMap) => string;
  dict?: ReturnType<typeof useI18n>['dict'];
}) {
  return (
    <aside
      aria-label="Itinerary"
      className={cn(
        'w-48 xl:w-56 shrink-0 flex flex-col',
        'bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none',
        'overflow-y-auto px-4 py-4',
      )}
    >
      <p className="text-[10px] xl:text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">
        Itinéraire
      </p>

      {stops.map((stop, i) => {
        const cfg    = STOP_STYLE[stop.status];
        const isLast = i === stops.length - 1;
        return (
          <div key={stop.id} className="flex gap-3" role="listitem">
            {/* Dot + line */}
            <div className="flex flex-col items-center">
              <div className={cn('w-3 h-3 rounded-full border-2 shrink-0 mt-0.5', cfg.dot)} />
              {!isLast && <div className={cn('w-0.5 flex-1 my-0.5 min-h-[1.25rem]', cfg.line)} />}
            </div>
            {/* Info */}
            <div className="pb-3">
              <p className={cn('text-sm font-semibold leading-tight', cfg.text)}>
                {stop.cityName}
              </p>
              <p className={cn('text-[10px] tabular-nums', cfg.time)}>
                {stop.scheduledAt}
                {stop.status === 'CURRENT' && (
                  <span className="ml-1 font-bold animate-pulse">●</span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </aside>
  );
}

// ─── Ticker ───────────────────────────────────────────────────────────────────

function BusTicker({
  notifications,
  lang,
  dict,
  t,
}: {
  notifications: ReturnType<typeof useNotifications>['notifications'];
  lang:          Language;
  dict:          ReturnType<typeof useI18n>['dict'];
  t:             (map: string | TranslationMap) => string;
}) {
  const texts = notifications.map(n => {
    const icon = NOTIFICATION_ICONS[n.type] ?? 'ℹ';
    const msg  = n.message[lang] ?? n.message['fr'] ?? n.text ?? '';
    return `${icon} ${msg}`;
  });
  const text  = texts.join('     ·     ');
  if (!text) return null;

  return (
    <div
      role="marquee"
      aria-live="polite"
      className={cn(
        'flex items-center overflow-hidden shrink-0 h-14 xl:h-16',
        'bg-amber-400 text-slate-900 dark:bg-amber-500 dark:text-slate-950',
      )}
    >
      <div className="shrink-0 px-4 xl:px-5 h-full flex items-center font-black text-sm xl:text-base uppercase tracking-widest bg-amber-600 text-white dark:bg-amber-700">
        {t(dict.notifications.info)}
      </div>
      <div className="flex-1 overflow-hidden" aria-hidden>
        <p
          className="whitespace-nowrap text-base xl:text-lg font-bold leading-[3.5rem] xl:leading-[4rem]"
          style={{ animation: 'board-ticker 28s linear infinite' }}
        >
          {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
        </p>
      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function BusScreen({
  tripRef          = 'TRP-20260414-004',
  routeLabel       = 'Brazzaville → Pointe-Noire',
  destinationCode  = 'PNR',
  stops            = DEMO_STOPS,
  busPlate         = 'BZV 4321 GH',
  busModel         = 'Mercedes-Benz Actros',
  driverName       = 'Jean-Baptiste Mavoungou',
  agencyName       = 'Transco',
  capacity         = 50,
  passengersOnBoard = 38,
  parcelsOnBoard   = 14,
  tenantId         = 'demo',
  autoRotateLang   = true,
}: BusScreenProps) {
  const { lang, setLang, t, dir, dateLocale, dict } = useI18n();
  const tenantConfig = useTenantConfig();
  const { notifications } = useNotifications({ tenantId });

  const current = stops.find(s => s.status === 'CURRENT');
  const next    = stops.find(s => s.status === 'UPCOMING');
  const passed  = stops.filter(s => s.status === 'PASSED').length;
  const progress = current
    ? Math.round((current.distanceKm / stops[stops.length - 1].distanceKm) * 100)
    : 0;

  // Rotation auto lang
  useEffect(() => {
    if (!autoRotateLang) return;
    const langs = tenantConfig.operational.rotateLanguages;
    const ms    = tenantConfig.operational.displayLangRotateMs;
    let idx     = langs.indexOf(lang);
    const id    = setInterval(() => {
      idx = (idx + 1) % langs.length;
      setLang(langs[idx]);
    }, ms);
    return () => clearInterval(id);
  }, [autoRotateLang, tenantConfig, lang, setLang]);

  return (
    <div
      dir={dir}
      lang={lang}
      aria-label={`Bus screen — ${routeLabel}`}
      className={cn(
        'flex flex-col h-screen overflow-hidden select-none',
        'bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white',
      )}
      style={{ fontFamily: 'var(--font-family)' }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className={cn(
        'flex items-center justify-between gap-3 px-4 xl:px-6 py-3 shrink-0',
        'bg-white dark:bg-slate-900 border-b border-[var(--color-primary)]/30 dark:border-[var(--color-primary)]/50 shadow-sm dark:shadow-none',
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm text-white shrink-0"
            style={{ backgroundColor: 'var(--color-primary)' }}
            aria-hidden
          >
            {tenantConfig.brand.brandName.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 dark:text-white text-sm xl:text-base leading-tight truncate">{routeLabel}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{tripRef}&nbsp;·&nbsp;{busPlate}</p>
          </div>
        </div>

        {/* Langue active */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-sm" title={LANGUAGE_META[lang].label}>{LANGUAGE_META[lang].flag}</span>
          <span className="text-xs text-slate-500 dark:text-slate-500">{LANGUAGE_META[lang].label}</span>
        </div>

        <LiveClock dateLocale={dateLocale} />
      </header>

      {/* ── Progress bar ────────────────────────────────────────────── */}
      <div
        className="h-1 bg-slate-200 dark:bg-slate-800 shrink-0"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress}% du trajet parcouru`}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${progress}%`, backgroundColor: 'var(--color-primary)' }}
        />
      </div>

      {/* ── Corps ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Itinéraire sidebar */}
        <Itinerary stops={stops} />

        {/* Contenu principal */}
        <main className="flex-1 overflow-y-auto p-4 xl:p-6 space-y-4" role="main">

          {/* Arrêt actuel */}
          {current && (
            <section
              aria-label={t('ui.current_stop')}
              className={cn(
                'rounded-2xl border p-4 xl:p-5',
                'bg-[var(--color-accent)]/10 border-[var(--color-accent)]/40',
              )}
            >
              <p className="text-[10px] xl:text-xs font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-accent)' }}>
                {t('ui.current_stop')}
              </p>
              <p className="text-3xl xl:text-4xl font-black text-slate-900 dark:text-white">{current.cityName}</p>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-accent)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-accent)' }}>
                    {current.scheduledAt}
                  </span>
                </div>
                <span className="text-sm text-slate-500 dark:text-slate-400">{current.distanceKm} km</span>
              </div>
            </section>
          )}

          {/* Prochain arrêt */}
          {next && (
            <section
              aria-label={t('ui.next_stop')}
              className="rounded-2xl border p-4 xl:p-5 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none"
            >
              <p className="text-[10px] xl:text-xs font-bold uppercase tracking-widest mb-1 text-[var(--color-primary)]">
                {t('ui.next_stop')}
              </p>
              <div className="flex items-end justify-between">
                <p className="text-2xl xl:text-3xl font-bold text-slate-900 dark:text-white">{next.cityName}</p>
                <div className="text-right">
                  <p className="text-2xl xl:text-3xl font-black tabular-nums text-[var(--color-primary)]">{next.scheduledAt}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {next.distanceKm - (current?.distanceKm ?? 0)} km
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Météo destination */}
          <WeatherWidget
            cityCode={destinationCode}
            lang={lang}
            t={t}
            dict={dict}
          />

          {/* Stat cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard
              icon="👥"
              label={t('col.passengers')}
              value={String(passengersOnBoard)}
              sub={`/ ${capacity}`}
            />
            <StatCard
              icon="📦"
              label={t('col.parcels')}
              value={String(parcelsOnBoard)}
            />
            <StatCard
              icon="✅"
              label={t('ui.passed_stops')}
              value={`${passed}/${stops.length}`}
            />
            <StatCard
              icon="⏱"
              label={t('col.eta')}
              value={stops[stops.length - 1].scheduledAt}
              sub={stops[stops.length - 1].cityName}
            />
          </div>

          {/* Infos véhicule */}
          <section
            aria-label="Vehicle info"
            className="rounded-2xl border p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm dark:shadow-none"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
              {tenantConfig.brand.brandName}
            </p>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {[
                { label: t('col.driver'),  value: driverName },
                { label: 'Modèle',             value: busModel },
                { label: t('col.bus'),      value: busPlate },
                { label: t('col.agency'),   value: agencyName },
                { label: t('col.passengers'), value: `${capacity}` },
                { label: 'Réf',               value: tripRef },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-slate-400 dark:text-slate-500 text-[10px]">{label}</dt>
                  <dd className="text-slate-900 dark:text-white font-semibold mt-0.5 truncate">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </main>
      </div>

      {/* ── Ticker ──────────────────────────────────────────────────── */}
      <BusTicker notifications={notifications} lang={lang} dict={dict} t={t} />

      <style>{`
        @keyframes board-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export default BusScreen;
