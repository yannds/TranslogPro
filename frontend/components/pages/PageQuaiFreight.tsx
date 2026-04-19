/**
 * PageQuaiFreight — Gestion du fret au quai (portail agent de quai).
 *
 * Liste les trajets du jour, l'agent en sélectionne un et utilise le
 * FreightLoadingPanel pour charger/décharger les colis. Même composant que
 * sur /driver/freight — seule la source de la liste de trajets diffère.
 *
 * Permissions requises : cf. iam.seed.ts rôle AGENT_QUAI (ajout 2026-04-19).
 */

import { useMemo, useState } from 'react';
import { Anchor, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton } from '../ui/Skeleton';
import { inputClass } from '../ui/inputClass';
import { Badge } from '../ui/Badge';
import { FreightLoadingPanel } from '../freight/FreightLoadingPanel';

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

function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function fmtHm(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Statuts pertinents pour l'agent de quai — on filtre les trajets en
// préparation / embarquement / en cours. Les trajets COMPLETED/CANCELLED
// sont cachés par défaut mais accessibles en changeant la date.
const ACTIVE_STATUSES = new Set([
  'SCHEDULED', 'PLANNED', 'PREPARING', 'READY',
  'OPEN', 'BOARDING', 'IN_PROGRESS',
]);

export function PageQuaiFreight() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [date, setDate] = useState(todayISO());
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const { data: trips, loading, error } = useFetch<TripLite[]>(
    tenantId ? `/api/tenants/${tenantId}/trips?from=${date}&to=${date}` : null,
    [tenantId, date],
  );

  // Pré-filtre sur les trajets opérationnels (pas les clôturés) + tri heure dép.
  const activeTrips = useMemo(
    () => (trips ?? [])
      .filter(t => ACTIVE_STATUSES.has(t.status))
      .sort((a, b) => a.departureScheduled.localeCompare(b.departureScheduled)),
    [trips],
  );

  const selectedTrip = activeTrips.find(t => t.id === selectedTripId);

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto" role="main" aria-label={t('quaiFreight.pageTitle')}>
      {/* Header */}
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <Anchor className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold t-text">{t('quaiFreight.pageTitle')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiFreight.pageSubtitle')}</p>
        </div>
      </header>

      <ErrorAlert error={error} icon />

      {/* Date picker + trip picker */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label htmlFor="quai-date" className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('quaiFreight.dateLabel')}
            </label>
            <input
              id="quai-date"
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setSelectedTripId(null); }}
              className={inputClass}
            />
          </div>
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <label htmlFor="quai-trip" className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('quaiFreight.tripLabel')}
            </label>
            <select
              id="quai-trip"
              value={selectedTripId ?? ''}
              onChange={e => setSelectedTripId(e.target.value || null)}
              className={inputClass}
              disabled={loading || activeTrips.length === 0}
            >
              <option value="">
                {activeTrips.length === 0 ? t('quaiFreight.noTrips') : t('quaiFreight.selectTripPh')}
              </option>
              {activeTrips.map(t => (
                <option key={t.id} value={t.id}>
                  {fmtHm(t.departureScheduled)} · {t.route?.origin?.name ?? '—'} → {t.route?.destination?.name ?? '—'}
                  {t.bus?.plateNumber ? ` (${t.bus.plateNumber})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Loading */}
      {loading && (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      )}

      {/* Empty */}
      {!loading && !selectedTrip && activeTrips.length > 0 && (
        <div className="flex flex-col items-center py-12 text-slate-500 dark:text-slate-400" role="status">
          <AlertCircle className="w-10 h-10 mb-3" aria-hidden />
          <p className="text-sm font-medium">{t('quaiFreight.pickTrip')}</p>
        </div>
      )}

      {/* Trip + Panel */}
      {selectedTrip && (
        <>
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                {t('quaiFreight.selectedTrip')}
              </p>
              <p className="text-base font-bold t-text">
                {selectedTrip.route?.origin?.name ?? '—'} → {selectedTrip.route?.destination?.name ?? '—'}
              </p>
              <p className="text-xs t-text-3 mt-0.5">
                {fmtHm(selectedTrip.departureScheduled)}
                {selectedTrip.bus?.plateNumber && <> · {selectedTrip.bus.plateNumber}</>}
                {selectedTrip.reference && <> · <span className="font-mono">{selectedTrip.reference}</span></>}
              </p>
            </div>
            <Badge variant="info">{selectedTrip.status}</Badge>
          </section>

          <FreightLoadingPanel tenantId={tenantId} tripId={selectedTrip.id} role="quai" />
        </>
      )}
    </main>
  );
}
