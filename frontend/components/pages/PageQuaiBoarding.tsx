/**
 * PageQuaiBoarding — embarquement passagers au quai (agent de quai).
 *
 * Cycle blueprint (Traveler) :
 *   CONFIRMED (ticket)  → CHECK_IN  (perm ticket.scan.agency)    → CHECKED_IN
 *   CHECKED_IN          → SCAN_BOARD (perm traveler.verify.agency) → BOARDED
 *
 * Flow :
 *   1. Agent choisit la date + le trajet (TripPickerForDay)
 *   2. Liste des tickets du trajet (enrichie avec le statut Traveler) via
 *      `/flight-deck/trips/:tripId/passengers` — même endpoint que la BusScreen.
 *      Important : on liste les tickets, PAS les Travelers — sinon on ne voit
 *      que les passagers déjà scannés. Un ticket CONFIRMED sans Traveler est
 *      visible avec status='CONFIRMED' (statut fallback).
 *   3. Action contextuelle par ligne :
 *        status CONFIRMED  → « Enregistrer » (check-in façade → SCAN_IN blueprint)
 *        status CHECKED_IN → « Embarquer »  (board façade   → SCAN_BOARD)
 *        status BOARDED    → badge read-only
 *
 * Accepte `?tripId=...` dans l'URL (lien depuis PageQuaiHome / PageQuaiScan
 * après un scan réussi). La page poll toutes les 10s pour refléter les
 * scans faits en parallèle depuis un autre onglet ou par le chauffeur.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, UserCheck, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }  from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, ApiError } from '../../lib/api';
import { Badge }      from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Skeleton }   from '../ui/Skeleton';
import { TripPickerForDay } from '../agent/TripPickerForDay';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

interface Traveler {
  id:            string;   // ticketId (côté backend c'est `id` du ticket, pas du traveler)
  passengerName: string;
  seatNumber:    string | null;
  fareClass:     string | null;
  status:        string;   // CONFIRMED | CHECKED_IN | BOARDED | NO_SHOW | CANCELLED
  luggageKg:     number | null;
}

type BV = 'default' | 'info' | 'success' | 'warning' | 'danger';
const STATUS_VARIANT: Record<string, BV> = {
  CONFIRMED: 'default', CHECKED_IN: 'info', BOARDED: 'success',
  NO_SHOW:   'danger',  CANCELLED:  'warning',
};

export function PageQuaiBoarding() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [search] = useSearchParams();
  const initialTripId = search.get('tripId');

  const [tripId, setTripId] = useState<string | null>(initialTripId);
  useEffect(() => { if (initialTripId) setTripId(initialTripId); }, [initialTripId]);

  // Endpoint `flight-deck/.../passengers` = liste tickets (tous statuts non
  // annulés) enrichie avec le statut Traveler. Même source que la BusScreen,
  // donc aucune divergence entre les écrans.
  const passengersUrl = tenantId && tripId
    ? `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers`
    : null;
  const { data: travelers, loading, refetch } = useFetch<Traveler[]>(
    passengersUrl,
    [passengersUrl],
  );

  // Polling 10s — permet de voir en direct les scans faits par le chauffeur
  // (mobile) ou par un autre agent quai sur un autre poste.
  useEffect(() => {
    if (!passengersUrl) return;
    const id = setInterval(() => refetch(), 10_000);
    return () => clearInterval(id);
  }, [passengersUrl, refetch]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  /**
   * Action = transition blueprint. On passe par la facade flight-deck qui
   * délègue à TravelerService + WorkflowEngine — même chemin que le scan QR.
   * check-in est POST, board est PATCH (convention REST du back).
   */
  const runAction = useCallback(async (ticketId: string, kind: 'check-in' | 'board') => {
    if (!tenantId || !tripId) return;
    setBusyId(ticketId); setError(null);
    try {
      const url = `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers/${ticketId}/${kind}`;
      const headers = { 'Idempotency-Key': `${kind}:${ticketId}` };
      if (kind === 'check-in') {
        await apiPost(url, {}, { headers });
      } else {
        await apiPatch(url, {}, { headers });
      }
      refetch();
    } catch (e) {
      setError(e instanceof ApiError
        ? String((e.body as { message?: string })?.message ?? e.message)
        : String(e));
    } finally { setBusyId(null); }
  }, [tenantId, tripId, refetch]);

  const columns: Column<Traveler>[] = useMemo(() => [
    { key: 'seatNumber', header: t('quaiBoarding.colSeat'), width: '80px', cellRenderer: v => v ?? '—' },
    { key: 'passengerName', header: t('quaiBoarding.colName'), sortable: true },
    { key: 'fareClass', header: t('quaiBoarding.colClass'), width: '100px', cellRenderer: v => v ?? '—' },
    { key: 'luggageKg', header: t('quaiBoarding.colLuggage'), width: '100px', align: 'right',
      cellRenderer: v => (v as number | null) != null ? `${v} kg` : '—' },
    { key: 'status', header: t('quaiBoarding.colStatus'), width: '140px',
      cellRenderer: v => <Badge variant={STATUS_VARIANT[String(v)] ?? 'default'} size="sm">{String(v)}</Badge> },
  ], [t]);

  const rowActions: RowAction<Traveler>[] = [
    {
      label:   t('quaiBoarding.checkIn'),
      icon:    <UserCheck size={13} />,
      hidden:  (r) => r.status !== 'CONFIRMED',
      disabled:(r) => busyId === r.id,
      onClick: (r) => runAction(r.id, 'check-in'),
    },
    {
      label:   t('quaiBoarding.board'),
      icon:    <CheckCircle2 size={13} />,
      hidden:  (r) => r.status !== 'CHECKED_IN',
      disabled:(r) => busyId === r.id,
      onClick: (r) => runAction(r.id, 'board'),
    },
  ];

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiBoarding.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiBoarding.subtitle')}</p>
        </div>
      </header>

      <TripPickerForDay selectedTripId={tripId} onChange={setTripId} />

      <ErrorAlert error={error} icon />

      {!tripId ? (
        <p className="text-sm t-text-3 text-center py-10">{t('quaiBoarding.pickTrip')}</p>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          {/* Mini-KPI — progression embarquement */}
          {travelers && travelers.length > 0 && (() => {
            const boarded    = travelers.filter(x => x.status === 'BOARDED').length;
            const checkedIn  = travelers.filter(x => x.status === 'CHECKED_IN').length;
            const confirmed  = travelers.filter(x => x.status === 'CONFIRMED').length;
            return (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="success">{boarded}/{travelers.length} {t('quaiBoarding.boardedCount')}</Badge>
                <Badge variant="info">{checkedIn} {t('quaiBoarding.checkedInCount')}</Badge>
                <Badge variant="default">{confirmed} {t('quaiBoarding.pendingCount')}</Badge>
              </div>
            );
          })()}

          <DataTableMaster<Traveler>
            columns={columns}
            data={travelers ?? []}
            loading={loading}
            rowActions={rowActions}
            defaultPageSize={50}
            emptyMessage={t('quaiBoarding.empty')}
            stickyHeader
          />
        </>
      )}
      {busyId && <div role="status" className="fixed bottom-4 right-4 bg-slate-800 text-white px-3 py-2 rounded-lg text-xs flex items-center gap-2 shadow-lg"><Loader2 className="w-3 h-3 animate-spin" />{t('common.saving')}</div>}
    </main>
  );
}
