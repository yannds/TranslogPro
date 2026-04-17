/**
 * TripDatePicker — Calendrier déroulant avec dates en gras quand un trajet existe.
 *
 * Props :
 *   value       — date sélectionnée (YYYY-MM-DD)
 *   onChange    — callback quand l'utilisateur clique sur un jour
 *   tripDates   — Set<string> de dates ISO ayant au moins un trajet
 *   loading     — true pendant le fetch des dates
 *   minDate     — date minimum sélectionnable (défaut: aujourd'hui)
 *   locale      — "fr" | "en" | "ar" etc. pour les noms de jours/mois
 *   t           — fonction i18n
 */

import { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TripDatePickerProps {
  value:      string;
  onChange:   (date: string) => void;
  tripDates:  Set<string>;
  loading?:   boolean;
  minDate?:   string;
  locale?:    string;
  t:          (key: string) => string;
  onMonthChange?: (yearMonth: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  // 0=Sun → shift so Monday=0
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TripDatePicker({
  value, onChange, tripDates, loading, minDate, locale = 'fr', t, onMonthChange,
}: TripDatePickerProps) {
  const today = useMemo(() => toISO(new Date()), []);
  const min   = minDate ?? today;

  const [open, setOpen]         = useState(false);
  const [viewYear, setViewYear]   = useState(() => Number(value.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(() => Number(value.slice(5, 7)) - 1);

  const monthLabel = useMemo(() => {
    const d = new Date(viewYear, viewMonth, 1);
    return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }, [viewYear, viewMonth, locale]);

  const weekDays = useMemo(() => {
    const base = new Date(2024, 0, 1); // Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 2);
    });
  }, [locale]);

  const days = useMemo(() => {
    const total  = daysInMonth(viewYear, viewMonth);
    const offset = firstDayOfWeek(viewYear, viewMonth);
    return { total, offset };
  }, [viewYear, viewMonth]);

  const navigate = useCallback((dir: -1 | 1) => {
    let m = viewMonth + dir;
    let y = viewYear;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setViewMonth(m);
    setViewYear(y);
    onMonthChange?.(`${y}-${String(m + 1).padStart(2, '0')}`);
  }, [viewMonth, viewYear, onMonthChange]);

  const handleSelect = useCallback((day: number) => {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso < min) return;
    onChange(iso);
    setOpen(false);
  }, [viewYear, viewMonth, min, onChange]);

  const displayLabel = useMemo(() => {
    return new Date(value).toLocaleDateString(locale, {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  }, [value, locale]);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
    }
  }, [open]);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-left"
      >
        {displayLabel}
      </button>

      {/* Dropdown calendar — rendered via portal to escape overflow:hidden parents */}
      {open && createPortal(
        <div
          style={{ position: 'absolute', top: pos.top, left: pos.left }}
          className="z-[9999] w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3 animate-in fade-in slide-in-from-top-1"
        >
          {/* Nav header */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => navigate(-1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              aria-label={t('portail.calPrev')}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize">
              {monthLabel}
            </span>
            <button type="button" onClick={() => navigate(1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              aria-label={t('portail.calNext')}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {weekDays.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-semibold text-slate-400 uppercase py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-px">
            {/* Offset cells */}
            {Array.from({ length: days.offset }, (_, i) => (
              <div key={`off-${i}`} />
            ))}

            {/* Day cells */}
            {Array.from({ length: days.total }, (_, i) => {
              const day   = i + 1;
              const iso   = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isPast     = iso < min;
              const isSelected = iso === value;
              const isToday    = iso === today;
              const hasTrip    = tripDates.has(iso);

              return (
                <button
                  key={day}
                  type="button"
                  disabled={isPast}
                  onClick={() => handleSelect(day)}
                  className={[
                    'relative flex items-center justify-center h-9 rounded-lg text-sm transition-all',
                    isPast
                      ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                      : 'hover:bg-amber-50 dark:hover:bg-amber-900/20 cursor-pointer',
                    isSelected
                      ? 'bg-amber-500 text-white font-bold hover:bg-amber-600'
                      : '',
                    isToday && !isSelected
                      ? 'ring-1 ring-amber-400'
                      : '',
                    hasTrip && !isSelected && !isPast
                      ? 'font-bold text-slate-900 dark:text-white'
                      : '',
                    !hasTrip && !isSelected && !isPast
                      ? 'text-slate-500 dark:text-slate-400'
                      : '',
                  ].join(' ')}
                  aria-label={`${day} ${hasTrip ? t('portail.calHasTrips') : ''}`}
                >
                  {day}
                  {/* Dot indicator for trip availability */}
                  {hasTrip && !isSelected && !isPast && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          {loading ? (
            <p className="text-[10px] text-center text-slate-400 mt-2">{t('portail.calLoading')}</p>
          ) : (
            <div className="flex items-center justify-center gap-3 mt-2 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                {t('portail.calHasTrips')}
              </span>
              <span className="flex items-center gap-1">
                <span className="font-bold text-slate-700 dark:text-slate-300">{t('portail.calBold')}</span>
                = {t('portail.calAvailable')}
              </span>
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* Click-outside overlay — also via portal */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
