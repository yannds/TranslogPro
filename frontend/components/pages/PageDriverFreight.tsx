/**
 * PageDriverFreight — Gestion du fret du trajet actif (portail chauffeur).
 *
 * Le chauffeur charge lui-même les colis dans la soute quand il n'y a pas
 * d'agent de quai (petites compagnies). Le FreightLoadingPanel expose les
 * transitions workflow (LOAD → LOADED, puis DEPART automatique avec le
 * trajet, puis ARRIVE / DELIVER). La même UI est réutilisée sur /quai.
 *
 * Permissions requises (cf. iam.seed.ts rôle DRIVER, ajouts 2026-04-19) :
 *   data.parcel.scan.agency · data.parcel.update.agency
 *   data.parcel.report.agency · data.parcel.print.agency
 */

import { Truck, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton } from '../ui/Skeleton';
import { FreightLoadingPanel } from '../freight/FreightLoadingPanel';

interface ActiveTrip {
  id:        string;
  status:    string;
  reference?: string | null;
  route?: {
    name?: string | null;
    origin?:      { id: string; name: string } | null;
    destination?: { id: string; name: string } | null;
  } | null;
}

export function PageDriverFreight() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: trip, loading, error } = useFetch<ActiveTrip | null>(
    tenantId ? `/api/tenants/${tenantId}/flight-deck/active-trip` : null,
    [tenantId],
  );

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto" role="main" aria-label={t('driverFreight.pageTitle')}>
      {/* Header */}
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <Truck className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold t-text">{t('driverFreight.pageTitle')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('driverFreight.pageSubtitle')}</p>
        </div>
      </header>

      <ErrorAlert error={error} icon />

      {/* Loading */}
      {loading && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}

      {/* Empty */}
      {!loading && !trip && !error && (
        <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
          <AlertCircle className="w-10 h-10 mb-3" aria-hidden />
          <p className="font-medium">{t('driverFreight.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverFreight.noActiveTripMsg')}</p>
        </div>
      )}

      {/* Trip + Panel */}
      {trip && (
        <>
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
              {t('driverFreight.currentTrip')}
            </p>
            <p className="text-base font-bold t-text">
              {trip.route?.origin?.name ?? '—'} → {trip.route?.destination?.name ?? '—'}
            </p>
            {trip.reference && (
              <p className="text-xs font-mono t-text-3 mt-0.5">{trip.reference}</p>
            )}
          </section>

          <FreightLoadingPanel tenantId={tenantId} tripId={trip.id} role="driver" />
        </>
      )}
    </main>
  );
}
