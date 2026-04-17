/**
 * PageDriverManifest — Manifeste passagers du trajet actif (lecture seule)
 *
 * Affiche la liste formelle des passagers du trajet en cours pour le chauffeur.
 * Données : GET /flight-deck/active-trip + /passengers
 * Export CSV/PDF via DataTableMaster.
 */

import { useMemo } from 'react';
import { FileText, Users } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Badge } from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import DataTableMaster, { type Column } from '../DataTableMaster';

/* ── Types ──────────────────────────────────────────────────────────── */

interface ActiveTrip {
  id:           string;
  reference?:   string | null;
  route?:       { name?: string; origin?: { name: string } | null; destination?: { name: string } | null } | null;
  bus?:         { plateNumber: string; model?: string | null } | null;
  departureScheduled?: string | null;
  travelers?:   { id: string }[];
}

interface Passenger {
  id:             string;
  passengerName:  string;
  passengerPhone: string | null;
  seatNumber:     string | null;
  fareClass:      string | null;
  status:         string;
  luggageKg:      number | null;
  checkedInAt:    string | null;
  boardedAt:      string | null;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'default';

const STATUS_MAP: Record<string, { labelKey: string; variant: BadgeVariant }> = {
  CHECKED_IN: { labelKey: 'driverManifest.statusCheckedIn',  variant: 'info'    },
  BOARDED:    { labelKey: 'driverManifest.statusBoarded',     variant: 'success' },
  NO_SHOW:    { labelKey: 'driverManifest.statusNoShow',      variant: 'danger'  },
  CANCELLED:  { labelKey: 'driverManifest.statusCancelled',   variant: 'warning' },
  CONFIRMED:  { labelKey: 'driverManifest.statusConfirmed',   variant: 'default' },
};

function StatusBadgeCell({ status }: { status: string }) {
  const { t } = useI18n();
  const s = STATUS_MAP[status] ?? { labelKey: status, variant: 'default' as BadgeVariant };
  return <Badge variant={s.variant} size="sm">{t(s.labelKey)}</Badge>;
}

/* ── Columns ────────────────────────────────────────────────────────── */

const columns: Column<Passenger>[] = [
  { key: 'seatNumber',     header: 'Siège',     sortable: true, width: '80px',  cellRenderer: v => v ?? '—' },
  { key: 'passengerName',  header: 'Nom',       sortable: true },
  { key: 'passengerPhone', header: 'Téléphone', sortable: false, cellRenderer: v => (v as string | null) ?? '—' },
  { key: 'fareClass',      header: 'Classe',    sortable: true, width: '100px', cellRenderer: v => (v as string | null) ?? '—' },
  { key: 'luggageKg',      header: 'Bagages (kg)', sortable: true, align: 'right', width: '110px',
    cellRenderer: v => (v as number | null) != null ? `${(v as number).toLocaleString('fr-FR')} kg` : '—',
    csvValue:     v => (v as number | null) != null ? String(v) : '',
  },
  { key: 'status', header: 'Statut', sortable: true, width: '130px',
    cellRenderer: v => <StatusBadgeCell status={v as string} />,
    csvValue:     v => String(v),
  },
];

/* ── Component ──────────────────────────────────────────────────────── */

export function PageDriverManifest() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: trip, loading: loadingTrip, error: errorTrip } =
    useFetch<ActiveTrip>(tenantId ? `/api/tenants/${tenantId}/flight-deck/active-trip` : null, [tenantId]);

  const { data: passengers, loading: loadingPax, error: errorPax } =
    useFetch<Passenger[]>(
      trip?.id ? `/api/tenants/${tenantId}/flight-deck/trips/${trip.id}/passengers` : null,
      [tenantId, trip?.id],
    );

  const paxList = useMemo(() => passengers ?? [], [passengers]);

  const boardedCount   = useMemo(() => paxList.filter(p => p.status === 'BOARDED').length, [paxList]);
  const checkedInCount = useMemo(() => paxList.filter(p => p.status === 'CHECKED_IN').length, [paxList]);
  const noShowCount    = useMemo(() => paxList.filter(p => p.status === 'NO_SHOW').length, [paxList]);

  const error = errorTrip || errorPax;
  const loading = loadingTrip || loadingPax;

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Manifeste passagers">
      {/* ── Header ── */}
      <header className="flex items-center gap-3">
        <FileText className="w-7 h-7 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverManifest.pageTitle')}</h1>
          {trip && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {trip.reference && <span className="font-medium text-slate-700 dark:text-slate-300">{trip.reference}</span>}
              {trip.route?.name && <span> — {trip.route.name}</span>}
            </p>
          )}
        </div>
      </header>

      <ErrorAlert error={error} />

      {/* ── Empty state ── */}
      {!loading && !trip && !error && (
        <div className="flex flex-col items-center py-20 text-slate-500 dark:text-slate-400" role="status">
          <FileText className="w-12 h-12 mb-4 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-base font-medium">{t('driverManifest.noActiveTrip')}</p>
          <p className="text-sm mt-1">{t('driverManifest.noActiveTripMsg')}</p>
        </div>
      )}

      {/* ── Trip summary ── */}
      {trip && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: t('driverManifest.reference'), value: trip.reference ?? '—' },
            { label: t('driverManifest.route'), value: trip.route?.name ?? '—' },
            { label: t('driverManifest.bus'), value: trip.bus?.plateNumber ?? '—' },
            { label: t('driverManifest.departureLabel'), value: trip.departureScheduled ? new Date(trip.departureScheduled).toLocaleString('fr-FR') : '—' },
          ].map(item => (
            <div key={item.label} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── KPI passagers ── */}
      {trip && !loading && (
        <div className="flex flex-wrap gap-4">
          <KpiPill icon={<Users className="w-4 h-4" aria-hidden />} label={t('driverManifest.total')} value={paxList.length} />
          <KpiPill label={t('driverManifest.boarded')}   value={boardedCount}   className="text-green-700 dark:text-green-400" />
          <KpiPill label={t('driverManifest.checkedIn')} value={checkedInCount} className="text-blue-700 dark:text-blue-400" />
          <KpiPill label={t('driverManifest.absent')}    value={noShowCount}    className="text-red-700 dark:text-red-400" />
        </div>
      )}

      {/* ── Passenger table ── */}
      {trip && (
        <DataTableMaster<Passenger>
          columns={columns}
          data={paxList}
          loading={loading}
          emptyMessage={t('driverManifest.emptyMsg')}
          exportFormats={['csv', 'pdf']}
          exportFilename="manifeste"
        />
      )}
    </main>
  );
}

/* ── Internal KPI pill ──────────────────────────────────────────────── */

function KpiPill({ icon, label, value, className = '' }: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 ${className}`}>
      {icon}
      <span>{label}</span>
      <span className="font-bold">{value}</span>
    </div>
  );
}
