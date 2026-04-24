/**
 * PageNotifications — Centre de notifications temps réel.
 *
 * Affiche le flux du hook useNotifications (WebSocket-ready) avec :
 *   - Indicateur de connexion (isConnected → aria-live region)
 *   - Filtrage par type (toutes, urgentes, infos, sécurité…)
 *   - Filtrage par priorité
 *   - Dismiss individuel et clearAll
 *   - Support multilingue via TranslationMap (tous locales)
 *
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA, ARIA.
 */
import { useMemo, useState } from 'react';
import {
  Bell, BellRing, CircleX, Trash2, Wifi, WifiOff,
  AlertTriangle, ShieldAlert, Cloud, Clock3, Info, Bus, Banknote, ShieldCheck,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { useAnnouncementFeed } from '../../lib/hooks/useAnnouncementFeed';
import type { Notification, NotificationType } from '../../lib/hooks/useNotifications';
import type { Language, TranslationMap } from '../../lib/i18n/types';

// ─── Mapping type → icône + classes ──────────────────────────────────────────

const TYPE_META: Record<NotificationType, { icon: typeof Bell; classes: string }> = {
  DELAY_ALERT:        { icon: Clock3,       classes: 'bg-amber-100  text-amber-700  dark:bg-amber-900/40  dark:text-amber-400' },
  SECURITY_ALERT:     { icon: ShieldAlert,  classes: 'bg-red-100    text-red-700    dark:bg-red-900/40    dark:text-red-400'   },
  ROAD_SAFETY:        { icon: ShieldCheck,  classes: 'bg-teal-100   text-teal-700   dark:bg-teal-900/40   dark:text-teal-400'  },
  WEATHER_UPDATE:     { icon: Cloud,        classes: 'bg-sky-100    text-sky-700    dark:bg-sky-900/40    dark:text-sky-400'   },
  TARIFF_CHANGE:      { icon: Banknote,     classes: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400'},
  TRIP_STATUS_CHANGE: { icon: Bus,          classes: 'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-400'  },
  GENERAL_INFO:       { icon: Info,         classes: 'bg-slate-100  text-slate-700  dark:bg-slate-800     dark:text-slate-300' },
};

const PRIORITY_DOT: Record<Notification['priority'], string> = {
  1: 'bg-red-500',
  2: 'bg-amber-500',
  3: 'bg-slate-400 dark:bg-slate-600',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pickMessage(msg: TranslationMap, lang: Language, fallback?: string): string {
  return (msg as Record<string, string | undefined>)[lang] ?? msg.fr ?? fallback ?? '';
}

type TypeFilter = 'all' | NotificationType;
type PriorityFilter = 'all' | 1 | 2 | 3;

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageNotifications() {
  const { t, lang, dateLocale } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.effectiveTenantId ?? user?.tenantId ?? null;

  const { notifications, isConnected, dismiss, clearAll } = useAnnouncementFeed({ tenantId });

  const [typeFilter, setTypeFilter]         = useState<TypeFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');

  const visible = useMemo(() => {
    return notifications.filter(n => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      if (priorityFilter !== 'all' && n.priority !== priorityFilter) return false;
      return true;
    });
  }, [notifications, typeFilter, priorityFilter]);

  const counts = useMemo(() => {
    const c = { total: notifications.length, urgent: 0, info: 0 };
    for (const n of notifications) {
      if (n.priority === 1) c.urgent += 1;
      else if (n.priority === 2) c.info += 1;
    }
    return c;
  }, [notifications]);

  const TYPE_LABEL: Record<TypeFilter, string> = {
    all:                t('notifCenter.allTypes'),
    DELAY_ALERT:        t('notifCenter.typeDelay'),
    SECURITY_ALERT:     t('notifCenter.typeSecurity'),
    ROAD_SAFETY:        t('notifCenter.typeSafety'),
    WEATHER_UPDATE:     t('notifCenter.typeWeather'),
    TARIFF_CHANGE:      t('notifCenter.typeTariff'),
    TRIP_STATUS_CHANGE: t('notifCenter.typeTrip'),
    GENERAL_INFO:       t('notifCenter.typeInfo'),
  };

  const PRIORITY_LABEL: Record<PriorityFilter, string> = {
    all: t('notifCenter.allPriorities'),
    1:   t('notifCenter.priUrgent'),
    2:   t('notifCenter.priImportant'),
    3:   t('notifCenter.priNormal'),
  };

  const formatTime = (d: Date) =>
    d.toLocaleString(dateLocale, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <h1 className="text-2xl font-bold t-text">{t('notifCenter.title')}</h1>
          </div>
          <p className="text-sm t-text-2 mt-1">{t('notifCenter.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
              isConnected ? 't-delta-up' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
            )}
          >
            {isConnected
              ? <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
              : <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />}
            {isConnected ? t('notifCenter.connected') : t('notifCenter.disconnected')}
          </div>
          <button
            type="button"
            onClick={clearAll}
            disabled={notifications.length === 0}
            className="inline-flex items-center gap-1 text-xs font-semibold t-text-body border t-border rounded-lg px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {t('notifCenter.clearAll')}
          </button>
        </div>
      </header>

      {/* Counters */}
      <section aria-labelledby="notif-counters-title">
        <h2 id="notif-counters-title" className="sr-only">{t('notifCenter.countersTitle')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="t-card-bordered rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Bell className="w-4 h-4 t-text-3" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('notifCenter.total')}</p>
            </div>
            <p className="text-3xl font-black t-text tabular-nums">{counts.total}</p>
          </div>
          <div className="t-card-bordered rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('notifCenter.urgent')}</p>
            </div>
            <p className="text-3xl font-black text-red-600 dark:text-red-400 tabular-nums">{counts.urgent}</p>
          </div>
          <div className="t-card-bordered rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-500" aria-hidden="true" />
              <p className="text-xs font-semibold t-text-2 uppercase tracking-wider">{t('notifCenter.important')}</p>
            </div>
            <p className="text-3xl font-black text-amber-600 dark:text-amber-500 tabular-nums">{counts.info}</p>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section aria-labelledby="notif-filters-title" className="t-card-bordered rounded-2xl p-4 space-y-3">
        <h2 id="notif-filters-title" className="sr-only">{t('notifCenter.filtersTitle')}</h2>
        <div>
          <label htmlFor="notif-type-select" className="block text-[10px] font-semibold t-text-2 uppercase tracking-wider mb-1.5">
            {t('notifCenter.filterByType')}
          </label>
          <div role="radiogroup" aria-labelledby="notif-filters-title" className="flex flex-wrap gap-2">
            {(Object.keys(TYPE_LABEL) as TypeFilter[]).map(type => {
              const active = typeFilter === type;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTypeFilter(type)}
                  className={cn(
                    'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    active
                      ? 'bg-teal-600 text-white'
                      : 't-surface t-text-body hover:bg-gray-200 dark:hover:bg-slate-700',
                  )}
                >
                  {TYPE_LABEL[type]}
                </button>
              );
            })}
          </div>
          {/* Hidden select as escape hatch for form-submit contexts — kept consistent with label-for */}
          <select id="notif-type-select" className="sr-only" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
            {(Object.keys(TYPE_LABEL) as TypeFilter[]).map(tp => <option key={tp} value={tp}>{TYPE_LABEL[tp]}</option>)}
          </select>
        </div>

        <div>
          <p className="block text-[10px] font-semibold t-text-2 uppercase tracking-wider mb-1.5">
            {t('notifCenter.filterByPriority')}
          </p>
          <div role="radiogroup" aria-label={t('notifCenter.filterByPriority')} className="flex flex-wrap gap-2">
            {(['all', 1, 2, 3] as PriorityFilter[]).map(p => {
              const active = priorityFilter === p;
              return (
                <button
                  key={String(p)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPriorityFilter(p)}
                  className={cn(
                    'text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    active
                      ? 'bg-teal-600 text-white'
                      : 't-surface t-text-body hover:bg-gray-200 dark:hover:bg-slate-700',
                  )}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Feed */}
      <section
        aria-labelledby="notif-feed-title"
        aria-live="polite"
        aria-relevant="additions"
      >
        <h2 id="notif-feed-title" className="text-sm font-semibold t-text mb-3">
          {t('notifCenter.feedTitle')} ({visible.length})
        </h2>
        {visible.length === 0 ? (
          <div className="t-card-bordered rounded-2xl p-8 text-center">
            <Bell className="w-8 h-8 t-text-3 mx-auto mb-3" aria-hidden="true" />
            <p className="t-text-2 text-sm">{t('notifCenter.empty')}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map(n => {
              const meta = TYPE_META[n.type];
              const Icon = meta.icon;
              return (
                <li
                  key={n.id}
                  className="t-card-bordered rounded-2xl p-3 sm:p-4 flex items-start gap-2 sm:gap-3"
                >
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', meta.classes)}>
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={cn('w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[n.priority])}
                        role="img"
                        aria-label={PRIORITY_LABEL[n.priority]}
                      />
                      <span className="text-xs font-semibold t-text-2 uppercase tracking-wider">
                        {TYPE_LABEL[n.type]}
                      </span>
                      <span className="text-[11px] t-text-3 tabular-nums">
                        {formatTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="t-text-body text-sm break-words">
                      {pickMessage(n.message, lang, n.text)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(n.id)}
                    aria-label={`${t('notifCenter.dismiss')} — ${TYPE_LABEL[n.type]}`}
                    className="shrink-0 t-text-3 hover:t-text transition-colors p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    <CircleX className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
