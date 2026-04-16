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
import { cn }                  from '../../lib/utils';
import { useI18n }             from '../../lib/i18n/useI18n';
import { useWeather, WEATHER_ICONS } from '../../lib/hooks/useWeather';
import { useNotifications }    from '../../lib/hooks/useNotifications';
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
  passengersOnBoard:  number;
  capacity:          number;
  parcelsLoaded:     number;
  statusId:          string;
  departAt:          Date;
  tenantId?:         string;
  autoRotateLang?:   boolean;
}

// ─── Countdown ────────────────────────────────────────────────────────────────

function Countdown({ targetDate, t, dict }: {
  targetDate: Date;
  t:   (m: string | TranslationMap) => string;
  dict: ReturnType<typeof useI18n>['dict'];
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

  if (diff === 0) {
    return (
      <span className="text-emerald-400 text-5xl xl:text-6xl font-black animate-pulse">
        {t('status.DEPARTED')}
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
      className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mt-1"
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
      <p className="text-3xl xl:text-4xl font-black text-white leading-none">
        {now.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-xs text-slate-400 mt-0.5 capitalize">
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
  const texts = notifications.map(n => n.message[lang] ?? n.message['fr'] ?? '');
  const text  = texts.join('   ·   ');
  if (!text) return null;
  return (
    <div
      role="marquee"
      aria-live="polite"
      className="flex items-center overflow-hidden shrink-0 h-10 bg-[var(--color-accent)] text-slate-900 dark:text-slate-950"
    >
      <div className="shrink-0 px-3 h-full flex items-center font-black text-xs uppercase tracking-widest bg-amber-600 text-white">
        {t(dict.notifications.info)}
      </div>
      <div className="flex-1 overflow-hidden" aria-hidden>
        <p className="whitespace-nowrap text-sm font-semibold leading-10"
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
  passengersOnBoard:   31,
  capacity:            50,
  parcelsLoaded:       18,
  statusId:            'BOARDING',
  departAt:            (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })(),
};

export function QuaiScreen(props: Partial<QuaiScreenProps> = {}) {
  const p = { ...DEMO_PROPS, ...props };
  const { lang, setLang, t, dir, dateLocale, dict } = useI18n();
  const tenantConfig   = useTenantConfig();
  const { notifications } = useNotifications({ tenantId: p.tenantId ?? 'demo' });
  const { weather }    = useWeather(p.destinationCode);

  const statusCfg = tenantConfig.statuses[p.statusId];

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
      className="flex flex-col h-screen overflow-hidden select-none bg-slate-950 dark:bg-slate-950 text-white"
      style={{ fontFamily: 'var(--font-family)' }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className={cn(
        'flex items-center justify-between gap-4 px-6 xl:px-8 py-4 xl:py-5 shrink-0',
        'bg-slate-900 dark:bg-slate-900 border-b-2 border-[var(--color-primary)]',
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
            <p className="text-slate-400 text-sm mt-2">
              {t('ui.departure_in')}&nbsp;
              <Countdown targetDate={p.departAt} t={t} dict={dict} />
            </p>
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
          'bg-gradient-to-r from-[var(--color-primary)]/10 to-transparent',
          'border-b border-slate-800',
        )}
      >
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-primary)] mb-1">
              {t('col.destination')}
            </p>
            <p className="text-5xl xl:text-6xl font-black uppercase tracking-wide text-white">
              {p.destination}
            </p>
            {p.via && (
              <p className="text-slate-400 text-base mt-1.5">via&nbsp;{p.via}</p>
            )}
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-widest">{t('col.time')}</p>
              <p className="text-6xl xl:text-7xl font-black text-[var(--color-primary)] tabular-nums leading-none">
                {p.departureTime}
              </p>
            </div>
            {/* Météo destination mini */}
            {weather && (
              <div className="flex items-center gap-2 text-sm bg-slate-800 rounded-xl px-3 py-1.5 border border-slate-700">
                <span>{WEATHER_ICONS[weather.condition]}</span>
                <span className="font-bold text-white">{weather.tempC}°C</span>
                <span className="text-slate-400">{weather.cityName}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Stat cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-4 px-6 xl:px-8 py-5 flex-1">

        {/* Bus */}
        <div className="bg-slate-900 dark:bg-slate-900 rounded-2xl border border-slate-800 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{t('col.bus')}</p>
            <p className="text-xl xl:text-2xl font-black text-white font-mono">{p.busPlate}</p>
            <p className="text-sm text-slate-400 mt-1">{p.busModel}</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400 font-semibold">En position</span>
          </div>
        </div>

        {/* Passagers */}
        <div className="bg-slate-900 dark:bg-slate-900 rounded-2xl border border-slate-800 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{t('col.passengers')}</p>
            <div className="flex items-end gap-1">
              <p className="text-4xl xl:text-5xl font-black text-white tabular-nums">{p.passengersOnBoard}</p>
              <p className="text-xl text-slate-500 mb-1">/{p.capacity}</p>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1">
              <span>{p.passengersConfirmed} confirmés</span>
              <span>{Math.round((p.passengersOnBoard / p.capacity) * 100)}%</span>
            </div>
            <OccupancyBar value={p.passengersOnBoard} max={p.capacity} />
          </div>
        </div>

        {/* Colis */}
        <div className="bg-slate-900 dark:bg-slate-900 rounded-2xl border border-slate-800 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{t('col.parcels')}</p>
            <p className="text-4xl xl:text-5xl font-black text-white tabular-nums">{p.parcelsLoaded}</p>
            <p className="text-sm text-slate-400 mt-1">chargés</p>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-xs text-purple-400 font-semibold">Chargement</span>
          </div>
        </div>

        {/* Chauffeur */}
        <div className="bg-slate-900 dark:bg-slate-900 rounded-2xl border border-slate-800 dark:border-slate-800 p-4 xl:p-5 flex flex-col justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">{t('col.driver')}</p>
            <p className="text-xl xl:text-2xl font-bold text-white leading-tight">{p.driverName}</p>
            <p className="text-sm text-slate-400 mt-1">{p.agencyName}</p>
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
      <Ticker notifications={notifications} lang={lang} t={t} dict={dict} />

      <style>{`
        @keyframes board-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export default QuaiScreen;
