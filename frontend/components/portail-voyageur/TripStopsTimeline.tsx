/**
 * TripStopsTimeline — timeline visuelle des arrêts d'un trajet.
 *
 * Composant présentation pur, réutilisable (web portail voyageur + admin).
 * Met en évidence la gare de montée (boarding) et la gare de descente
 * (alighting) pour un segment, qu'il soit OD complet ou intermédiaire.
 *
 * Props :
 *   stops                : liste ordonnée des arrêts enrichis (backend searchTrips)
 *   boardingStationId    : gare où monte le voyageur (défaut = 1er stop)
 *   alightingStationId   : gare où il descend (défaut = dernier stop)
 *   isIntermediateSegment: true si pas OD complet → affichage plus explicite
 *   compact              : layout dense pour les listes
 *   t                    : fonction i18n (portail.*)
 *
 * Accessibilité :
 *   - role="list" / role="listitem" explicites
 *   - aria-current="true" sur boarding et alighting
 *   - aria-label avec nom + heure pour lecteur d'écran
 */

import { cn } from '../../lib/utils';

export interface TripStop {
  stationId:    string;
  name:         string;
  city:         string;
  km:           number;
  order:        number;
  estimatedAt:  string; // ISO
  isBoarding?:  boolean;
  isAlighting?: boolean;
}

export interface TripStopsTimelineProps {
  stops:                 TripStop[];
  boardingStationId?:    string;
  alightingStationId?:   string;
  isIntermediateSegment?: boolean;
  compact?:              boolean;
  t:                     (key: string) => string;
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function TripStopsTimeline({
  stops,
  boardingStationId,
  alightingStationId,
  isIntermediateSegment,
  compact = false,
  t,
}: TripStopsTimelineProps) {
  if (!stops || stops.length === 0) return null;

  // Résoud boarding/alighting par défaut si non passés explicitement : 1er / dernier
  const boardingIdx  = boardingStationId
    ? stops.findIndex(s => s.stationId === boardingStationId)
    : 0;
  const alightingIdx = alightingStationId
    ? stops.findIndex(s => s.stationId === alightingStationId)
    : stops.length - 1;

  return (
    <div
      className={cn(
        'relative rounded-xl border border-slate-200 dark:border-slate-700/50 bg-slate-50/60 dark:bg-slate-800/30',
        compact ? 'p-3' : 'p-4',
      )}
      role="region"
      aria-label={t('portail.timelineTitle')}
    >
      {isIntermediateSegment && (
        <div className="mb-2 flex items-center gap-1.5" aria-live="polite">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M8 3v3M16 3v3M5 10h14M5 6h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"/></svg>
            {t('portail.intermediateSegment')}
          </span>
        </div>
      )}

      <ol role="list" className="relative space-y-2.5">
        {/* Fil vertical */}
        <span
          aria-hidden="true"
          className="absolute left-[7px] top-1.5 bottom-1.5 w-0.5 bg-gradient-to-b from-slate-300 via-slate-300 to-slate-300 dark:from-slate-600 dark:via-slate-600 dark:to-slate-600 rounded-full"
        />

        {stops.map((stop, idx) => {
          const isBoarding  = idx === boardingIdx;
          const isAlighting = idx === alightingIdx;
          const isInSegment = idx >= boardingIdx && idx <= alightingIdx;
          const label       = stop.city || stop.name;

          return (
            <li
              key={stop.stationId}
              role="listitem"
              aria-current={isBoarding || isAlighting ? 'true' : undefined}
              aria-label={`${label} — ${fmtTime(stop.estimatedAt)}${isBoarding ? ' · ' + t('portail.boardingAt') : ''}${isAlighting ? ' · ' + t('portail.alightingAt') : ''}`}
              className={cn(
                'relative pl-6 flex items-start justify-between gap-2',
                !isInSegment && 'opacity-50',
              )}
            >
              {/* Point de timeline */}
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-0 top-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0',
                  isBoarding
                    ? 'bg-emerald-500 border-emerald-600 ring-2 ring-emerald-500/20'
                    : isAlighting
                      ? 'bg-rose-500 border-rose-600 ring-2 ring-rose-500/20'
                      : isInSegment
                        ? 'bg-[color:var(--portal-accent,theme(colors.amber.500))] border-[color:var(--portal-accent-dark,theme(colors.amber.600))]'
                        : 'bg-slate-200 border-slate-300 dark:bg-slate-700 dark:border-slate-600',
                )}
              >
                {isBoarding && (
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                )}
              </span>

              {/* Libellé + heure */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      'text-sm',
                      (isBoarding || isAlighting) ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300',
                    )}
                  >
                    {label}
                  </span>
                  {isBoarding && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
                      {t('portail.boardingBadge')}
                    </span>
                  )}
                  {isAlighting && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400">
                      {t('portail.alightingBadge')}
                    </span>
                  )}
                </div>
                {stop.name && stop.name !== label && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{stop.name}</p>
                )}
              </div>

              {/* Heure estimée */}
              <time
                dateTime={stop.estimatedAt}
                className={cn(
                  'shrink-0 tabular-nums text-xs',
                  (isBoarding || isAlighting) ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400',
                )}
              >
                {fmtTime(stop.estimatedAt)}
              </time>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
