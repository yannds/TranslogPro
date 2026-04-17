/**
 * PageSavClaims — Réclamations SAV
 *
 * API :
 *   GET /api/v1/tenants/:tid/sav/claims
 */

import {
  FileWarning, Eye, CheckCircle2,
} from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge }         from '../ui/Badge';
import { ErrorAlert }    from '../ui/ErrorAlert';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED';

interface ClaimRow {
  id:              string;
  reference:       string;
  claimantName:    string;
  claimantPhone:   string | null;
  category:        string;
  subject:         string;
  status:          ClaimStatus;
  priority:        string;
  tripReference:   string | null;
  ticketReference: string | null;
  createdAt:       string;
  resolvedAt:      string | null;
}

const STATUS_VARIANT: Record<ClaimStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  OPEN:        'warning',
  IN_PROGRESS: 'default',
  RESOLVED:    'success',
  CLOSED:      'default',
  REJECTED:    'danger',
};

// ─── Build Columns ────────────────────────────────────────────────────────────

function buildColumns(t: (k: string) => string): Column<ClaimRow>[] {
  return [
    {
      key: 'reference', header: t('savClaims.type'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <FileWarning className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100">{row.reference}</span>
        </div>
      ),
    },
    { key: 'claimantName', header: t('savClaims.reporter'),     sortable: true },
    { key: 'category',     header: t('savClaims.claimType'),    sortable: true },
    {
      key: 'subject', header: t('savClaims.description'),
      cellRenderer: (v) => {
        const s = v as string;
        return <span className="truncate block max-w-[200px]">{s}</span>;
      },
    },
    {
      key: 'status', header: t('savClaims.status'), sortable: true,
      cellRenderer: (_v, row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>{row.status}</Badge>
      ),
    },
    {
      key: 'createdAt', header: t('savClaims.created'), sortable: true,
      cellRenderer: (v) => new Date(v as string).toLocaleDateString('fr-FR'),
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageSavClaims() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';

  const { data: claims, loading, error } = useFetch<ClaimRow[]>(
    tenantId ? `/api/tenants/${tenantId}/sav/claims` : null,
    [tenantId],
  );

  const columns = buildColumns(t);

  const rowActions: RowAction<ClaimRow>[] = [
    { icon: <Eye className="w-4 h-4" />,            label: t('savClaims.details'),  onClick: () => {} },
    { icon: <CheckCircle2 className="w-4 h-4" />,   label: t('savClaims.resolve'),  onClick: () => {} },
  ];

  return (
    <div className="p-6 min-w-0 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 shrink-0">
          <FileWarning className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50 truncate">
            {t('savClaims.title')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
            {t('savClaims.subtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <DataTableMaster
        data={claims ?? []}
        columns={columns}
        rowActions={rowActions}
        loading={loading}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="reclamations-sav"
        emptyMessage={t('savClaims.noClaims')}
        searchPlaceholder={t('savClaims.searchPlaceholder')}
      />
    </div>
  );
}
