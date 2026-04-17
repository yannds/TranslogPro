/**
 * SeatMapPicker — Grille interactive de sélection de siège bus.
 *
 * Props :
 *   seatLayout       – configuration du bus { rows, cols, aisleAfter?, disabled? }
 *   occupiedSeats    – liste des sièges déjà attribués (ex: ["1-1", "3-2"])
 *   selectedSeat     – siège actuellement sélectionné (contrôlé)
 *   onSelect         – callback quand un siège disponible est cliqué
 *   seatSelectionFee – montant supplément choix de siège (informatif)
 *   currency         – devise pour l'affichage du supplément
 *   disabled         – désactiver toute interaction (ex: pendant le chargement)
 */

import { useMemo } from 'react';
import { useI18n } from '../../lib/i18n/useI18n';

interface SeatLayout {
  rows:        number;
  cols:        number;
  aisleAfter?: number;
  disabled?:   string[];
}

interface SeatMapPickerProps {
  seatLayout:        SeatLayout;
  occupiedSeats:     string[];
  selectedSeat:      string | null;
  onSelect:          (seatId: string) => void;
  seatSelectionFee?: number;
  currency?:         string;
  disabled?:         boolean;
}

type SeatState = 'available' | 'occupied' | 'selected' | 'disabled';

const SEAT_STYLES: Record<SeatState, string> = {
  available:
    'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-800 cursor-pointer border-teal-300 dark:border-teal-700',
  occupied:
    'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed border-slate-300 dark:border-slate-600 line-through',
  selected:
    'bg-green-500 dark:bg-green-600 text-white cursor-pointer border-green-600 dark:border-green-500 ring-2 ring-green-400',
  disabled:
    'invisible',
};

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function SeatMapPicker({
  seatLayout,
  occupiedSeats,
  selectedSeat,
  onSelect,
  seatSelectionFee = 0,
  currency = 'XAF',
  disabled = false,
}: SeatMapPickerProps) {
  const { t } = useI18n();

  const occupiedSet = useMemo(() => new Set(occupiedSeats), [occupiedSeats]);
  const disabledSet = useMemo(() => new Set(seatLayout.disabled ?? []), [seatLayout.disabled]);

  const totalActive = seatLayout.rows * seatLayout.cols - disabledSet.size;
  const availableCount = totalActive - occupiedSet.size;

  function getSeatState(seatId: string): SeatState {
    if (disabledSet.has(seatId)) return 'disabled';
    if (occupiedSet.has(seatId)) return 'occupied';
    if (selectedSeat === seatId) return 'selected';
    return 'available';
  }

  function handleClick(seatId: string) {
    if (disabled) return;
    const state = getSeatState(seatId);
    if (state === 'available' || state === 'selected') {
      onSelect(seatId);
    }
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {t('sellTicket.frontOfVehicle')}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {availableCount} / {totalActive} {t('sellTicket.seatsAvailable')}
        </p>
      </div>

      {/* Supplément */}
      {seatSelectionFee > 0 && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 rounded px-2 py-1">
          {t('sellTicket.seatFeeNotice')}: {formatCurrency(seatSelectionFee, currency)}
        </div>
      )}

      {/* Grid */}
      <div className="flex flex-col items-center gap-1">
        {Array.from({ length: seatLayout.rows }, (_, rowIdx) => {
          const row = rowIdx + 1;
          return (
            <div key={row} className="flex items-center gap-1">
              {/* Row number */}
              <span className="w-5 text-xs text-right text-slate-400 dark:text-slate-500 mr-1 select-none">
                {row}
              </span>

              {Array.from({ length: seatLayout.cols }, (_, colIdx) => {
                const col = colIdx + 1;
                const seatId = `${row}-${col}`;
                const state = getSeatState(seatId);
                const showAisle = seatLayout.aisleAfter !== undefined && col === seatLayout.aisleAfter;

                return (
                  <span key={col} className="contents">
                    <button
                      type="button"
                      className={`
                        w-8 h-8 rounded text-xs font-medium border transition-colors
                        ${SEAT_STYLES[state]}
                        ${disabled ? 'opacity-60 pointer-events-none' : ''}
                      `}
                      onClick={() => handleClick(seatId)}
                      disabled={disabled || state === 'occupied' || state === 'disabled'}
                      title={
                        state === 'occupied'
                          ? t('sellTicket.seatOccupied')
                          : state === 'selected'
                            ? t('sellTicket.seatSelected')
                            : seatId
                      }
                      aria-label={`${t('sellTicket.seat')} ${seatId}`}
                    >
                      {state !== 'disabled' ? col : ''}
                    </button>
                    {showAisle && <span className="w-4" aria-hidden />}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 pt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-teal-100 dark:bg-teal-900/50 border border-teal-300 dark:border-teal-700" />
          {t('sellTicket.legendAvailable')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600" />
          {t('sellTicket.legendOccupied')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-green-500 dark:bg-green-600 border border-green-600 dark:border-green-500" />
          {t('sellTicket.legendSelected')}
        </span>
      </div>
    </div>
  );
}
