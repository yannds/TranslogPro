/**
 * TripPickerForDay — sélecteur "date + trajet" réutilisable par l'agent de quai.
 *
 * Affiche un date-picker + un dropdown des trajets opérationnels du jour.
 * Utilisé par toutes les pages /quai/* qui ont besoin de scoper leur action
 * à un trajet précis (embarquement, manifeste, bagages, fret).
 *
 * Props :
 *   selectedTripId  : state géré par le parent (string | null)
 *   onChange        : callback sur sélection
 *   date/setDate    : pour permettre au parent de persister la date (optionnel)
 *
 * Backend : GET /api/tenants/:tid/trips?from=YYYY-MM-DD&to=YYYY-MM-DD
 */

import { useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { inputClass } from '../ui/inputClass';
import { ErrorAlert } from '../ui/ErrorAlert';

interface TripLite {
  id:                 string;
  status:             string;
  reference?:         string | null;
  departureScheduled: string;
  route?: {
    name?: string | null;
    origin?:      { id: string; name: string } | null;
    destination?: { id: string; name: string } | null;
  } | null;
  bus?: { plateNumber?: string | null } | null;
}

const ACTIVE_STATUSES = new Set([
  'SCHEDULED', 'PLANNED', 'PREPARING', 'READY',
  'OPEN', 'BOARDING', 'IN_PROGRESS',
]);

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export interface TripPickerProps {
  selectedTripId: string | null;
  onChange:       (tripId: string | null) => void;
  /** Filtre d'états — par défaut ACTIVE_STATUSES (tous les trajets non-clos). */
  includeAllStatuses?: boolean;
}

export function TripPickerForDay({
  selectedTripId, onChange, includeAllStatuses,
}: TripPickerProps) {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [date, setDate] = useState(todayISO());

  const { data: trips, loading, error } = useFetch<TripLite[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?from=${date}&to=${date}` : null,
    [tenantId, date],
  );

  const activeTrips = useMemo(
    () => (trips ?? [])
      .filter(tr => includeAllStatuses || ACTIVE_STATUSES.has(tr.status))
      .sort((a, b) => a.departureScheduled.localeCompare(b.departureScheduled)),
    [trips, includeAllStatuses],
  );

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <ErrorAlert error={error} icon />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('quaiPicker.date')}
          </label>
          <input type="date" value={date}
            onChange={e => { setDate(e.target.value); onChange(null); }}
            className={inputClass} />
        </div>
        <div className="flex-1 min-w-[220px] space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('quaiPicker.trip')}
          </label>
          <select value={selectedTripId ?? ''}
            onChange={e => onChange(e.target.value || null)}
            className={inputClass}
            disabled={loading || activeTrips.length === 0}>
            <option value="">
              {activeTrips.length === 0 ? t('quaiPicker.none') : t('quaiPicker.select')}
            </option>
            {activeTrips.map(tr => (
              <option key={tr.id} value={tr.id}>
                {fmtHm(tr.departureScheduled)} · {tr.route?.origin?.name ?? '—'} → {tr.route?.destination?.name ?? '—'}
                {tr.bus?.plateNumber ? ` (${tr.bus.plateNumber})` : ''} · {tr.status}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
