/**
 * PageDriverCheckin — Check-in / embarquement passagers (vue chauffeur)
 *
 * Le chauffeur voit la liste des passagers de son trajet et peut
 * marquer chaque passager comme « Embarqué » via le bouton d'action.
 *
 * API :
 *   GET   /api/tenants/:tid/flight-deck/active-trip
 *   GET   /api/tenants/:tid/flight-deck/trips/:tripId/passengers
 *   PATCH /api/tenants/:tid/flight-deck/trips/:tripId/passengers/:ticketId/board
 */

import { useMemo, useState } from 'react';
import { AlertCircle, UserCheck, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch } from '../../lib/api';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveTrip {
  id: string;
  status: string;
  reference?: string | null;
  bus?: { plateNumber: string } | null;
}

interface Passenger {
  id: string;
  passengerName: string;
  passengerPhone: string | null;
  seatNumber: string | null;
  fareClass: string | null;
  status: string;
  checkedInAt: string | null;
  boardedAt: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'default';

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  VERIFIED:   'default',
  CHECKED_IN: 'info',
  BOARDED:    'success',
  NO_SHOW:    'danger',
  CANCELLED:  'danger',
  CONFIRMED:  'warning',
};

const STATUS_LABEL: Record<string, string> = {
  VERIFIED:   'driverCheckin.statusConfirmed',
  CHECKED_IN: 'driverCheckin.statusCheckedIn',
  BOARDED:    'driverCheckin.statusBoarded',
  NO_SHOW:    'driverCheckin.statusNoShow',
  CANCELLED:  'driverCheckin.statusCancelled',
  CONFIRMED:  'driverCheckin.statusConfirmed',
};

function CheckinStatusCell({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[value] ?? 'default'} size="sm">
      {STATUS_LABEL[value] ? t(STATUS_LABEL[value]) : value}
    </Badge>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PageDriverCheckin() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: activeTrip, loading: loadingTrip } = useFetch<ActiveTrip>(
    tenantId ? `/api/tenants/${tenantId}/flight-deck/active-trip` : null,
    [tenantId],
  );

  const { data: passengers, loading: loadingPax, refetch } = useFetch<Passenger[]>(
    activeTrip?.id
      ? `/api/tenants/${tenantId}/flight-deck/trips/${activeTrip.id}/passengers`
      : null,
    [tenantId, activeTrip?.id],
  );

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const handleBoard = async (pax: Passenger) => {
    if (!activeTrip) return;
    setBusyId(pax.id);
    setError(null);
    try {
      await apiPatch(
        `/api/tenants/${tenantId}/flight-deck/trips/${activeTrip.id}/passengers/${pax.id}/board`,
        {},
      );
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('driverCheckin.errorBoard'));
    } finally {
      setBusyId(null);
    }
  };

  const paxList = passengers ?? [];
  const boardedCount = paxList.filter(p => p.status === 'BOARDED').length;
  const loading = loadingTrip || loadingPax;

  const busPlate = activeTrip?.bus?.plateNumber ?? '—';
  const columns = useMemo<Column<Passenger>[]>(() => [
    { key: 'passengerName', header: t('driverCheckin.colName'), sortable: true },
    { key: 'seatNumber', header: t('driverCheckin.colSeat'), sortable: true,
      cellRenderer: (v) => (v as string | null) ?? '—', width: '90px' },
    { key: 'fareClass', header: t('driverCheckin.colClass'), sortable: true,
      cellRenderer: (v) => (v as string | null) ?? '—', width: '100px' },
    { key: 'id', header: t('driverCheckin.colBus'), sortable: false, width: '120px',
      cellRenderer: () => busPlate, csvValue: () => busPlate },
    { key: 'status', header: t('driverCheckin.colStatus'), sortable: true, width: '130px',
      cellRenderer: (v) => <CheckinStatusCell value={v as string} />,
    },
  ], [t, busPlate]);

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Check passagers">
      <header className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <Users className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverCheckin.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverCheckin.pageSubtitle')}
          </p>
        </div>
        {paxList.length > 0 && (
          <Badge variant="info" size="sm" className="ml-auto">
            {boardedCount}/{paxList.length} {t('driverCheckin.boarded')}
          </Badge>
        )}
      </header>

      <ErrorAlert error={error} icon />

      {!loading && !activeTrip ? (
        <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
          <AlertCircle className="w-10 h-10 mb-3" aria-hidden />
          <p className="font-medium">{t('driverCheckin.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverCheckin.noActiveTripMsg')}</p>
        </div>
      ) : (
        <DataTableMaster<Passenger>
          columns={columns}
          data={paxList}
          loading={loading}
          emptyMessage={t('driverCheckin.emptyMsg')}
          exportFormats={['csv', 'pdf']}
          exportFilename="check-passagers"
          rowActions={[
            {
              label: t('driverCheckin.boardAction'),
              icon: <UserCheck className="w-4 h-4" />,
              onClick: (pax) => handleBoard(pax),
              hidden: (pax) => pax.status === 'BOARDED' || pax.status === 'CANCELLED',
              disabled: (pax) => busyId === pax.id,
            },
          ]}
        />
      )}
    </main>
  );
}
