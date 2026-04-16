/**
 * PageDriverCheckin — Check-in passagers (vue chauffeur)
 *
 * Affiche la liste des passagers du trajet actif du chauffeur
 * via l'endpoint flight-deck. Lecture seule (pas de mutation).
 */

import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Badge } from '../ui/Badge';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActiveTrip {
  id: string;
  reference?: string | null;
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
  CHECKED_IN: 'info',
  BOARDED: 'success',
  NO_SHOW: 'danger',
  CANCELLED: 'danger',
  CONFIRMED: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  CHECKED_IN: 'driverCheckin.statusCheckedIn',
  BOARDED:    'driverCheckin.statusBoarded',
  NO_SHOW:    'driverCheckin.statusNoShow',
  CANCELLED:  'driverCheckin.statusCancelled',
  CONFIRMED:  'driverCheckin.statusConfirmed',
};

// ─── Component ───────────────────────────────────────────────────────────────

function CheckinStatusCell({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Badge variant={STATUS_VARIANT[value] ?? 'default'} size="sm">
      {STATUS_LABEL[value] ? t(STATUS_LABEL[value]) : value}
    </Badge>
  );
}

export function PageDriverCheckin() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: activeTrip, loading: loadingTrip } = useFetch<ActiveTrip>(
    tenantId ? `/api/tenants/${tenantId}/flight-deck/active-trip` : null,
    [tenantId],
  );

  const { data: passengers, loading: loadingPax } = useFetch<Passenger[]>(
    activeTrip?.id
      ? `/api/tenants/${tenantId}/flight-deck/trips/${activeTrip.id}/passengers`
      : null,
    [tenantId, activeTrip?.id],
  );

  const columns = useMemo<Column<Passenger>[]>(() => [
    { key: 'passengerName', header: 'Nom', sortable: true },
    { key: 'passengerPhone', header: 'T\u00e9l\u00e9phone', sortable: false,
      cellRenderer: (v) => (v as string | null) ?? '\u2014' },
    { key: 'seatNumber', header: 'Si\u00e8ge', sortable: true,
      cellRenderer: (v) => (v as string | null) ?? '\u2014', width: '90px' },
    { key: 'fareClass', header: 'Classe', sortable: true,
      cellRenderer: (v) => (v as string | null) ?? '\u2014', width: '100px' },
    { key: 'status', header: 'Statut', sortable: true, width: '130px',
      cellRenderer: (v) => <CheckinStatusCell value={v as string} />,
    },
    { key: 'boardedAt', header: 'Embarqu\u00e9 \u00e0', sortable: true, width: '150px',
      cellRenderer: (v) =>
        (v as string | null)
          ? new Date(v as string).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
          : '\u2014',
    },
  ], []);

  const loading = loadingTrip || loadingPax;

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Check passagers">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverCheckin.pageTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('driverCheckin.pageSubtitle')}
        </p>
      </header>

      {!loading && !activeTrip ? (
        <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
          <AlertCircle className="w-10 h-10 mb-3" aria-hidden />
          <p className="font-medium">{t('driverCheckin.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverCheckin.noActiveTripMsg')}</p>
        </div>
      ) : (
        <DataTableMaster<Passenger>
          columns={columns}
          data={passengers ?? []}
          loading={loading}
          emptyMessage={t('driverCheckin.emptyMsg')}
          exportFormats={['csv', 'pdf']}
          exportFilename="check-passagers"
        />
      )}
    </main>
  );
}
