/**
 * Types et helpers partagés par les pages du module « Trajets & Planning ».
 *
 * Scope : opérationnel flotte / créneaux / lignes / retards.
 * Séparé du module Équipages (crew-planning / crew-briefing) qui traite
 * exclusivement l'affectation RH et la conformité équipage.
 */

// ─── Statuts trajet (alignés backend — TripState workflow-states.ts) ─────────

export type TripStatus =
  | 'PLANNED'
  | 'OPEN'
  | 'BOARDING'
  | 'IN_PROGRESS'
  | 'IN_PROGRESS_PAUSED'
  | 'IN_PROGRESS_DELAYED'
  | 'COMPLETED'
  | 'CANCELLED'
  | string;

export const TRIP_STATUS_LABEL: Record<string, string> = {
  PLANNED:              'Planifié',
  OPEN:                 'Ouvert',
  BOARDING:             'Embarquement',
  IN_PROGRESS:          'En route',
  IN_PROGRESS_PAUSED:   'En pause',
  IN_PROGRESS_DELAYED:  'En retard',
  COMPLETED:            'Terminé',
  CANCELLED:            'Annulé',
};

export function tripStatusLabel(s: string): string {
  return TRIP_STATUS_LABEL[s] ?? s;
}

export function tripStatusBadgeVariant(
  s: string,
): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  if (s === 'COMPLETED')                                       return 'success';
  if (s === 'IN_PROGRESS' || s === 'BOARDING')                 return 'info';
  if (s === 'IN_PROGRESS_PAUSED')                              return 'warning';
  if (s === 'IN_PROGRESS_DELAYED')                             return 'danger';
  if (s === 'CANCELLED')                                       return 'danger';
  return 'default';
}

// ─── Modèles (allégés — uniquement les champs utilisés en UI) ────────────────

export interface TripRow {
  id:                 string;
  tenantId?:          string;
  routeId:            string;
  busId?:             string | null;
  driverId?:          string | null;
  status:             TripStatus;
  departureScheduled: string;
  arrivalScheduled:   string;
  route?: {
    id?:              string;
    name?:            string | null;
    label?:           string | null;
    originName?:      string | null;
    destinationName?: string | null;
    distanceKm?:      number;
    basePrice?:       number;
  } | null;
  bus?: {
    id?:          string;
    plateNumber?: string | null;
    model?:       string | null;
  } | null;
}

export interface BusLite   { id: string; plateNumber: string; model?: string | null }
export interface StaffLite {
  id: string; userId: string; role: string; isAvailable: boolean;
  user: { email: string; name?: string | null; displayName?: string | null };
}
export interface RouteLite { id: string; name: string; distanceKm?: number; basePrice?: number }

// ─── Helpers de dates ────────────────────────────────────────────────────────

export function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = (r.getDay() + 6) % 7; // lundi = 0
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - day);
  return r;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatHm(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Libellé route ───────────────────────────────────────────────────────────

export function routeLabelOf(t: TripRow): string {
  return (
    t.route?.name
    ?? t.route?.label
    ?? [t.route?.originName, t.route?.destinationName].filter(Boolean).join(' → ')
    ?? 'Itinéraire inconnu'
  );
}

// ─── Routes dérivées des trajets (fallback sans endpoint backend) ────────────

export function deriveRoutesFromTrips(trips: TripRow[] | null | undefined): RouteLite[] {
  const seen = new Map<string, RouteLite>();
  (trips ?? []).forEach(t => {
    const id = t.route?.id ?? t.routeId;
    if (!id || seen.has(id)) return;
    seen.set(id, {
      id,
      name:       routeLabelOf(t),
      distanceKm: t.route?.distanceKm,
      basePrice:  t.route?.basePrice,
    });
  });
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Détection de retard ─────────────────────────────────────────────────────

/**
 * Un trajet est en "retard" si :
 *   - status explicite IN_PROGRESS_DELAYED, OU
 *   - departureScheduled est dans le passé et status encore PLANNED/OPEN
 */
export function isTripDelayed(t: TripRow, now: Date = new Date()): boolean {
  if (t.status === 'IN_PROGRESS_DELAYED') return true;
  if (['COMPLETED', 'CANCELLED'].includes(t.status)) return false;
  return new Date(t.departureScheduled).getTime() < now.getTime()
      && ['PLANNED', 'OPEN'].includes(t.status);
}

/** Minutes de retard (0 si pas en retard). */
export function delayMinutes(t: TripRow, now: Date = new Date()): number {
  if (!isTripDelayed(t, now)) return 0;
  const diff = (now.getTime() - new Date(t.departureScheduled).getTime()) / 60000;
  return Math.max(0, Math.round(diff));
}
