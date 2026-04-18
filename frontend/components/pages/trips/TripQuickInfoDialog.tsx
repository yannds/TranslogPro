/**
 * TripQuickInfoDialog — Aperçu détaillé d'un trajet (admin / dispatcher).
 *
 * Affiche véhicule, chauffeur, itinéraire, horaires, statut et les
 * expéditions groupées liées au trajet avec leur liste de colis.
 *
 * Partagé entre PageTripPlanning (click sur chip) et PageShipments
 * (click sur row) pour éviter la duplication.
 */

import { Bus, User2, MapPin, Clock, Package, Boxes } from 'lucide-react';
import { Dialog }     from '../../ui/Dialog';
import { Badge }      from '../../ui/Badge';
import { Skeleton }   from '../../ui/Skeleton';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { useFetch }   from '../../../lib/hooks/useFetch';
import { useI18n }    from '../../../lib/i18n/useI18n';
import {
  tripStatusBadgeVariant, tripStatusLabel,
} from './shared';

// ─── Types backend (alignés sur trip.service findOne) ────────────────────────

interface TripDetail {
  id:                 string;
  status:             string;
  departureScheduled: string;
  arrivalScheduled:   string;
  busId:              string;
  driverId?:          string | null;
  route?: {
    id?:          string;
    name?:        string | null;
    originName?:  string | null;
    origin?:      { id: string; name: string; city?: string | null } | null;
    destination?: { id: string; name: string; city?: string | null } | null;
    distanceKm?:  number | null;
  } | null;
  bus?: {
    id?:          string;
    plateNumber?: string | null;
    model?:       string | null;
  } | null;
  driver?: {
    id: string;
    user: { id: string; name?: string | null; email?: string | null };
  } | null;
  _count?: { shipments?: number };
}

interface ShipmentLite {
  id:              string;
  destinationId:   string;
  totalWeight:     number;
  remainingWeight: number;
  status:          string;
  parcels?: Array<{
    id:           string;
    trackingCode: string;
    status:       string;
    weight:       number;
  }>;
}

// ─── Helpers de formatage ────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric',
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Composant ───────────────────────────────────────────────────────────────

export function TripQuickInfoDialog({
  tripId,
  tenantId,
  onClose,
}: {
  tripId:   string;
  tenantId: string;
  onClose:  () => void;
}) {
  const { t } = useI18n();

  const { data: trip, loading: tripLoading, error: tripError } =
    useFetch<TripDetail>(
      tenantId ? `/api/tenants/${tenantId}/trips/${tripId}` : null,
      [tenantId, tripId],
    );

  const { data: shipments, loading: shipLoading } =
    useFetch<ShipmentLite[]>(
      tenantId ? `/api/tenants/${tenantId}/shipments/trips/${tripId}` : null,
      [tenantId, tripId],
    );

  const totalParcels = (shipments ?? []).reduce(
    (sum, s) => sum + (s.parcels?.length ?? 0), 0,
  );

  const driverLabel = trip?.driver?.user?.name
    ?? trip?.driver?.user?.email
    ?? t('tripQuickInfo.driverNotAssigned');

  const routeLabel =
    trip?.route?.name
    ?? (trip?.route?.origin?.name && trip?.route?.destination?.name
        ? `${trip.route.origin.name} → ${trip.route.destination.name}`
        : '—');

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('tripQuickInfo.title')}
      description={trip ? fmtDate(trip.departureScheduled) : ''}
      size="lg"
    >
      <div className="px-6 pb-6 space-y-5">
        {tripLoading && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        )}

        <ErrorAlert error={tripError} icon />

        {trip && !tripLoading && (
          <>
            {/* Status + horaires */}
            <section className="flex flex-wrap items-center gap-3">
              <Badge variant={tripStatusBadgeVariant(trip.status)} size="sm">
                {tripStatusLabel(trip.status)}
              </Badge>
              <div className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 tabular-nums">
                <Clock className="w-4 h-4 text-slate-400" aria-hidden />
                <span>{fmtTime(trip.departureScheduled)} → {fmtTime(trip.arrivalScheduled)}</span>
              </div>
            </section>

            {/* Grid info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoTile
                icon={<MapPin className="w-4 h-4" aria-hidden />}
                label={t('tripQuickInfo.route')}
                value={routeLabel}
                hint={trip.route?.distanceKm ? `${trip.route.distanceKm} km` : undefined}
              />
              <InfoTile
                icon={<Bus className="w-4 h-4" aria-hidden />}
                label={t('tripQuickInfo.vehicle')}
                value={trip.bus?.plateNumber ?? '—'}
                hint={trip.bus?.model ?? undefined}
              />
              <InfoTile
                icon={<User2 className="w-4 h-4" aria-hidden />}
                label={t('tripQuickInfo.driver')}
                value={driverLabel}
                hint={trip.driver?.user?.email ?? undefined}
              />
              <InfoTile
                icon={<Boxes className="w-4 h-4" aria-hidden />}
                label={t('tripQuickInfo.shipments')}
                value={String(trip._count?.shipments ?? 0)}
                hint={totalParcels > 0 ? t('tripQuickInfo.parcelsCount').replace('{n}', String(totalParcels)) : undefined}
              />
            </div>

            {/* Shipments + parcels */}
            <section aria-labelledby="trip-shipments-heading" className="pt-2">
              <h3
                id="trip-shipments-heading"
                className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2"
              >
                {t('tripQuickInfo.shipments')}
              </h3>

              {shipLoading ? (
                <Skeleton className="h-16 w-full rounded-lg" />
              ) : !shipments || shipments.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 italic">
                  {t('tripQuickInfo.noShipments')}
                </p>
              ) : (
                <ul role="list" className="space-y-3">
                  {shipments.map(s => {
                    const used = s.totalWeight - s.remainingWeight;
                    return (
                      <li key={s.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-slate-50 dark:bg-slate-800/40">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Boxes className="w-3.5 h-3.5 text-purple-500" aria-hidden />
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 font-mono">
                            {s.id.slice(0, 8)}
                          </span>
                          <Badge size="sm" variant={s.status === 'OPEN' ? 'warning' : 'default'}>{s.status}</Badge>
                          <span className="text-xs text-slate-500 tabular-nums ml-auto">
                            {used.toLocaleString('fr-FR')} / {s.totalWeight.toLocaleString('fr-FR')} kg
                          </span>
                        </div>
                        {s.parcels && s.parcels.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {s.parcels.map(p => (
                              <li key={p.id} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                                <Package className="w-3 h-3 text-slate-400" aria-hidden />
                                <span className="font-mono tabular-nums">{p.trackingCode}</span>
                                <Badge size="sm" variant="outline">{p.status}</Badge>
                                <span className="ml-auto tabular-nums">{p.weight} kg</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ─── Tuile info ──────────────────────────────────────────────────────────────

function InfoTile({
  icon, label, value, hint,
}: {
  icon:  React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-900/40">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        <span>{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100 truncate" title={value}>
        {value}
      </p>
      {hint && (
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate" title={hint}>
          {hint}
        </p>
      )}
    </div>
  );
}
