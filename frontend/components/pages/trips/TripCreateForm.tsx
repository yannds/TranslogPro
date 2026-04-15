/**
 * TripCreateForm — Formulaire de création d'un trajet (partagé).
 *
 * Utilisé par PageTrips et PageTripPlanning pour garder la création en un seul
 * endroit (DRY). Paye POST /api/tenants/:tid/trips via `onSubmit`.
 *
 * WCAG : labels explicites, aria-invalid via validation HTML native,
 *        FormFooter cohérent, dark mode.
 */

import { useState, type FormEvent } from 'react';
import { ErrorAlert }  from '../../ui/ErrorAlert';
import { FormFooter }  from '../../ui/FormFooter';
import { inputClass }  from '../../ui/inputClass';
import type { BusLite, RouteLite, StaffLite } from './shared';

export interface TripCreatePayload {
  routeId:              string;
  busId:                string;
  driverId:             string;     // Staff.id (SchedulingGuard)
  departureTime:        string;     // ISO
  estimatedArrivalTime?: string;     // ISO
}

export interface TripCreateFormProps {
  routes:  RouteLite[];
  buses:   BusLite[];
  drivers: StaffLite[];
  defaultDate: string;   // yyyy-mm-dd
  onSubmit: (payload: TripCreatePayload) => void;
  onCancel: () => void;
  busy:  boolean;
  error: string | null;
}

interface Values {
  routeId: string; busId: string; driverStaffId: string;
  date: string; time: string; arrivalTime: string;
}

function driverDisplayName(d: StaffLite): string {
  return d.user.displayName ?? d.user.name ?? d.user.email;
}

export function TripCreateForm({
  routes, buses, drivers, defaultDate, onSubmit, onCancel, busy, error,
}: TripCreateFormProps) {
  const [v, setV] = useState<Values>({
    routeId:       routes[0]?.id  ?? '',
    busId:         buses[0]?.id   ?? '',
    driverStaffId: drivers[0]?.id ?? '',
    date:          defaultDate,
    time:          '08:00',
    arrivalTime:   '',
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const departureISO = new Date(`${v.date}T${v.time}:00`).toISOString();
    const arrivalISO   = v.arrivalTime
      ? new Date(`${v.date}T${v.arrivalTime}:00`).toISOString()
      : undefined;
    onSubmit({
      routeId:              v.routeId,
      busId:                v.busId,
      driverId:             v.driverStaffId,
      departureTime:        departureISO,
      estimatedArrivalTime: arrivalISO,
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <ErrorAlert error={error} />

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="tc-route" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Itinéraire <span aria-hidden className="text-red-500">*</span>
          </label>
          <select
            id="tc-route" required value={v.routeId}
            onChange={e => setV(p => ({ ...p, routeId: e.target.value }))}
            className={inputClass}
            disabled={busy || routes.length === 0}
          >
            {routes.length === 0 && <option value="">Aucun itinéraire disponible</option>}
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {routes.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Créez d'abord un itinéraire depuis « Lignes &amp; Routes ».
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tc-bus" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Véhicule <span aria-hidden className="text-red-500">*</span>
          </label>
          <select
            id="tc-bus" required value={v.busId}
            onChange={e => setV(p => ({ ...p, busId: e.target.value }))}
            className={inputClass}
            disabled={busy || buses.length === 0}
          >
            {buses.length === 0 && <option value="">Aucun véhicule</option>}
            {buses.map(b => (
              <option key={b.id} value={b.id}>
                {b.plateNumber}{b.model ? ` — ${b.model}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tc-driver" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Chauffeur <span aria-hidden className="text-red-500">*</span>
          </label>
          <select
            id="tc-driver" required value={v.driverStaffId}
            onChange={e => setV(p => ({ ...p, driverStaffId: e.target.value }))}
            className={inputClass}
            disabled={busy || drivers.length === 0}
          >
            {drivers.length === 0 && <option value="">Aucun chauffeur</option>}
            {drivers.map(d => (
              <option key={d.id} value={d.id} disabled={!d.isAvailable}>
                {driverDisplayName(d)}{!d.isAvailable ? ' (indisponible)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tc-date" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Date <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="tc-date" type="date" required value={v.date}
            onChange={e => setV(p => ({ ...p, date: e.target.value }))}
            className={inputClass} disabled={busy}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tc-time" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Départ <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="tc-time" type="time" required value={v.time}
            onChange={e => setV(p => ({ ...p, time: e.target.value }))}
            className={inputClass} disabled={busy}
          />
        </div>

        <div className="col-span-2 space-y-1.5">
          <label htmlFor="tc-arr" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Arrivée estimée
          </label>
          <input
            id="tc-arr" type="time" value={v.arrivalTime}
            onChange={e => setV(p => ({ ...p, arrivalTime: e.target.value }))}
            className={inputClass} disabled={busy}
          />
        </div>
      </div>

      <FormFooter
        onCancel={onCancel}
        busy={busy}
        submitLabel="Créer le trajet"
        pendingLabel="Création…"
      />
    </form>
  );
}
