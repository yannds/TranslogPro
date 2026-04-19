/**
 * PageQuaiHome — « Mon quai » : dashboard agent de quai.
 *
 * Liste les trajets du jour avec statut, heure, route, bus, compteurs
 * (passagers / colis). Cliquer sur un trajet ouvre la page embarquement.
 *
 * API : GET /api/tenants/:tid/trips?from=today&to=today
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Anchor, Clock, Bus, MapPin, ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { ErrorAlert } from '../ui/ErrorAlert';

interface TripCard {
  id:                 string;
  status:             string;
  reference?:         string | null;
  departureScheduled: string;
  arrivalScheduled:   string;
  route?: {
    name?: string | null;
    origin?:      { id: string; name: string } | null;
    destination?: { id: string; name: string } | null;
  } | null;
  bus?: { plateNumber?: string | null } | null;
  _count?: { travelers?: number; shipments?: number };
}

const STATUS_VARIANT: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  SCHEDULED:   'default', PLANNED: 'default', PREPARING: 'info',
  READY:       'info',    OPEN:    'info',    BOARDING:  'warning',
  IN_PROGRESS: 'success', COMPLETED: 'default', CANCELLED: 'danger',
};

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function PageQuaiHome() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const navigate = useNavigate();
  const date = todayISO();

  const { data: trips, loading, error } = useFetch<TripCard[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?from=${date}&to=${date}` : null,
    [tenantId, date],
  );

  const sorted = useMemo(
    () => (trips ?? []).slice().sort((a, b) => a.departureScheduled.localeCompare(b.departureScheduled)),
    [trips],
  );

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <Anchor className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiHome.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiHome.subtitle')}</p>
        </div>
      </header>

      <ErrorAlert error={error} icon />

      {loading && (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      )}

      {!loading && sorted.length === 0 && !error && (
        <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
          <Bus className="w-10 h-10 mb-3" aria-hidden />
          <p className="font-medium">{t('quaiHome.noTrips')}</p>
        </div>
      )}

      <ul role="list" className="grid gap-3 sm:grid-cols-2">
        {sorted.map(tr => (
          <li key={tr.id}>
            <button
              type="button"
              onClick={() => navigate(`/quai/boarding?tripId=${tr.id}`)}
              className="w-full text-left rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 hover:border-purple-400 dark:hover:border-purple-600 focus-visible:ring-2 focus-visible:ring-purple-500 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold t-text flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-teal-500 shrink-0" aria-hidden />
                    {tr.route?.origin?.name ?? '—'} → {tr.route?.destination?.name ?? '—'}
                  </p>
                  <p className="text-xs t-text-3 mt-1 flex items-center gap-3 flex-wrap">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="w-3 h-3" aria-hidden />
                      {fmtHm(tr.departureScheduled)} → {fmtHm(tr.arrivalScheduled)}
                    </span>
                    {tr.bus?.plateNumber && (
                      <span className="inline-flex items-center gap-1">
                        <Bus className="w-3 h-3" aria-hidden />{tr.bus.plateNumber}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] t-text-3 mt-2">
                    👥 {tr._count?.travelers ?? 0} · 📦 {tr._count?.shipments ?? 0}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge variant={STATUS_VARIANT[tr.status] ?? 'default'} size="sm">{tr.status}</Badge>
                  <ChevronRight className="w-5 h-5 text-slate-300 dark:text-slate-600" aria-hidden />
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
