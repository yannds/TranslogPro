/**
 * PageSavReports — Signalements ouverts
 *
 * Affiche les réclamations au statut OPEN — incidents en cours de traitement.
 *
 * API :
 *   GET /api/tenants/:tid/sav/claims?status=OPEN
 */

import { useState } from 'react';
import { AlertTriangle, Eye } from 'lucide-react';
import { useAuth }       from '../../lib/auth/auth.context';
import { useFetch }      from '../../lib/hooks/useFetch';
import { useI18n }       from '../../lib/i18n/useI18n';
import { Badge, statusToVariant } from '../ui/Badge';
import { Dialog }        from '../ui/Dialog';
import { ErrorAlert }    from '../ui/ErrorAlert';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Claim {
  id:           string;
  type:         string;
  description:  string;
  status:       string;
  reporterId:   string;
  entityId?:    string;
  entityType?:  string;
  createdAt?:   string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageSavReports() {
  const { user } = useAuth();
  const { t }    = useI18n();
  const tenantId = user?.tenantId ?? '';

  const { data: reports, loading, error } = useFetch<Claim[]>(
    tenantId ? `/api/tenants/${tenantId}/sav/claims?status=OPEN` : null,
    [tenantId],
  );

  const [detail, setDetail] = useState<Claim | null>(null);

  const columns: Column<Claim>[] = [
    { key: 'type', header: t('savReports.type'), sortable: true,
      cellRenderer: (v) => <Badge size="sm" variant="warning">{v as string}</Badge> },
    { key: 'description', header: t('savReports.description'), sortable: false,
      cellRenderer: (v) => {
        const s = v as string;
        return s.length > 60 ? `${s.slice(0, 60)}…` : s;
      } },
    { key: 'reporterId', header: t('savReports.reporter'), sortable: true,
      cellRenderer: (v) => <span className="text-xs tabular-nums">{(v as string).slice(0, 8)}</span> },
    { key: 'createdAt', header: t('savReports.date'), sortable: true,
      cellRenderer: (v) => v ? new Date(v as string).toLocaleDateString('fr-FR') : '—' },
    { key: 'status', header: t('savReports.status'), sortable: true,
      cellRenderer: (v) => <Badge size="sm" variant={statusToVariant(v as string)}>{v as string}</Badge> },
  ];

  const rowActions: RowAction<Claim>[] = [
    { label: t('savReports.details'), icon: <Eye className="w-3.5 h-3.5" />,
      onClick: (row) => setDetail(row) },
  ];

  return (
    <main className="p-6 min-w-0 space-y-6" role="main" aria-label={t('savReports.title')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 dark:bg-orange-900/30">
          <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('savReports.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('savReports.subtitle')}</p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <DataTableMaster<Claim>
        columns={columns}
        data={reports ?? []}
        loading={loading}
        rowActions={rowActions}
        onRowClick={(row) => setDetail(row)}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        exportFormats={['csv', 'xls']}
        exportFilename="signalements"
        emptyMessage={t('savReports.noReports')}
        searchPlaceholder={t('savReports.searchPlaceholder')}
      />

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}
        title={t('savReports.reportDetail')} size="lg">
        {detail && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savReports.type')}</p>
              <Badge variant="warning">{detail.type}</Badge>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savReports.status')}</p>
              <Badge variant={statusToVariant(detail.status)}>{detail.status}</Badge>
            </div>
            <div className="col-span-2">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savReports.description')}</p>
              <p className="text-slate-700 dark:text-slate-300">{detail.description}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savReports.reporter')}</p>
              <p className="tabular-nums">{detail.reporterId.slice(0, 12)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{t('savReports.date')}</p>
              <p>{detail.createdAt ? new Date(detail.createdAt).toLocaleString('fr-FR') : '—'}</p>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}
