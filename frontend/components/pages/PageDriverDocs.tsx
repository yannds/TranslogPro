/**
 * PageDriverDocs — « Mes documents » (portail chauffeur)
 *
 * Affiche les licences / permis du chauffeur connecté (lecture seule).
 *
 * API :
 *   GET /api/tenants/:tid/crew-assignments/my        → assignments[] (pour résoudre staffId)
 *   GET /api/tenants/:tid/driver-profile/drivers/:staffId/licenses → License[]
 */

import { useMemo } from 'react';
import { FileText, FileCheck, AlertTriangle } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { Badge }      from '../ui/Badge';
import { ErrorAlert } from '../ui/ErrorAlert';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CrewAssignment {
  id:      string;
  staffId: string;
  [key: string]: unknown;
}

interface License {
  id:            string;
  staffId:       string;
  licenseNumber: string;
  licenseType:   string;
  issuedDate:    string;
  expiryDate:    string;
  fileKey?:      string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Days remaining until `iso` date. Negative = expired. */
function daysUntil(iso: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger';

function expiryVariant(iso: string): BadgeVariant {
  const d = daysUntil(iso);
  if (d < 0) return 'danger';
  if (d < 30) return 'warning';
  return 'success';
}

function expiryLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d < 0) return 'Expiré';
  if (d === 0) return "Expire aujourd'hui";
  if (d < 30) return `Expire dans ${d} j`;
  return formatDateFr(iso);
}

// ─── Colonnes DataTableMaster ─────────────────────────────────────────────────

const columns: Column<License>[] = [
  {
    key: 'licenseNumber',
    header: 'N° de permis',
    sortable: true,
    cellRenderer: (v) => (
      <span className="text-sm font-mono font-medium text-slate-900 dark:text-white">
        {String(v)}
      </span>
    ),
  },
  {
    key: 'licenseType',
    header: 'Type',
    sortable: true,
    width: '120px',
    cellRenderer: (v) => (
      <Badge variant="outline" size="sm">{String(v)}</Badge>
    ),
  },
  {
    key: 'issuedDate',
    header: 'Délivré le',
    sortable: true,
    width: '130px',
    cellRenderer: (v) => (
      <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">
        {formatDateFr(String(v))}
      </span>
    ),
    csvValue: (v) => formatDateFr(String(v)),
  },
  {
    key: 'expiryDate',
    header: 'Expiration',
    sortable: true,
    width: '150px',
    cellRenderer: (v) => {
      const iso = String(v);
      return (
        <Badge variant={expiryVariant(iso)} size="sm">
          {expiryLabel(iso)}
        </Badge>
      );
    },
    csvValue: (v) => formatDateFr(String(v)),
  },
  {
    key: 'fileKey',
    header: 'Fichier',
    sortable: false,
    width: '90px',
    cellRenderer: (v) =>
      v ? (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
          <FileCheck className="w-4 h-4" aria-hidden />
          <span className="text-xs font-medium">Joint</span>
        </span>
      ) : (
        <span className="text-xs text-slate-400">—</span>
      ),
    csvValue: (v) => (v ? 'Oui' : 'Non'),
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageDriverDocs() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base = `/api/tenants/${tenantId}`;

  // Step 1 — resolve staffId from crew assignments
  const { data: assignments, error: assignErr } = useFetch<CrewAssignment[]>(
    tenantId ? `${base}/crew-assignments/my` : null,
    [tenantId],
  );

  const staffId = useMemo(() => {
    if (!assignments || assignments.length === 0) return null;
    return assignments[0].staffId;
  }, [assignments]);

  // Step 2 — fetch licenses once staffId is known
  const {
    data: licenses,
    loading,
    error: licErr,
  } = useFetch<License[]>(
    staffId ? `${base}/driver-profile/drivers/${staffId}/licenses` : null,
    [staffId],
  );

  const error = assignErr || licErr;
  const items = licenses ?? [];

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Mes documents">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverDocs.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverDocs.pageSubtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      {/* Expiry alert banner */}
      {items.some((l) => daysUntil(l.expiryDate) < 30) && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800
                     bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
          role="alert"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden />
          <span>
            {t('driverDocs.expiryAlert')}
          </span>
        </div>
      )}

      {/* Table */}
      <DataTableMaster<License>
        columns={columns}
        data={items}
        loading={loading}
        defaultSort={{ key: 'expiryDate', dir: 'asc' }}
        defaultPageSize={25}
        searchPlaceholder={t('driverDocs.searchPh')}
        emptyMessage={t('driverDocs.emptyMsg')}
        exportFormats={['csv', 'json']}
        exportFilename="mes-documents"
        stickyHeader
      />
    </main>
  );
}
