/**
 * PageReports — Rapports périodiques (journaux de caisse + récapitulatifs mensuels).
 * Source : GET /api/v1/tenants/:id/analytics/reports (données réelles DB 30-90j)
 *
 * Utilise DataTableMaster (obligatoire pour toute liste/table).
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA.
 * Devise lue depuis TenantConfig (jamais hardcodée).
 */
import { useMemo, useState } from 'react';
import { FileBarChart, Eye, Calendar } from 'lucide-react';
import DataTableMaster from '../DataTableMaster';
import type { Column, RowAction } from '../DataTableMaster';
import { Dialog }           from '../ui/Dialog';
import { Badge }            from '../ui/Badge';
import { Button }           from '../ui/Button';
import { useI18n }          from '../../lib/i18n/useI18n';
import { useFetch }         from '../../lib/hooks/useFetch';
import { useAuth }          from '../../lib/auth/auth.context';
import { useTenantConfig }  from '../../providers/TenantConfigProvider';
import { cn }               from '../../lib/utils';
import type { Report }      from '../dashboard/types';

type Period = Report['period'];

export function PageReports() {
  const { t, dateLocale } = useI18n();
  const { user }         = useAuth();
  const { operational }  = useTenantConfig();
  const tenantId         = user?.effectiveTenantId;

  const { data, loading, error } = useFetch<Report[]>(
    tenantId ? `/api/tenants/${tenantId}/analytics/reports` : null,
    [tenantId],
  );

  const reports = data ?? [];
  const [periodFilter, setPeriodFilter] = useState<'all' | Period>('all');
  const [selected, setSelected]         = useState<Report | null>(null);

  const fmtAmount = useMemo(
    () => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }),
    [],
  );

  const PERIOD_LABEL: Record<'all' | Period, string> = {
    all:     t('reports.filterAll'),
    daily:   t('reports.periodDaily'),
    weekly:  t('reports.periodWeekly'),
    monthly: t('reports.periodMonthly'),
  };

  const STATUS_BADGE: Record<Report['status'], { label: string; classes: string }> = {
    ready:       { label: t('reports.statusReady'),       classes: 't-delta-up' },
    discrepancy: { label: t('reports.statusDiscrepancy'), classes: 't-delta-down' },
  };

  const visibleReports = useMemo(
    () => periodFilter === 'all' ? reports : reports.filter(r => r.period === periodFilter),
    [periodFilter, reports],
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' });

  const columns: Column<Report>[] = [
    {
      key: 'title', header: t('reports.colTitle'), sortable: true,
      cellRenderer: (v) => (
        <div className="flex items-center gap-2">
          <FileBarChart className="w-4 h-4 t-text-3 shrink-0" aria-hidden="true" />
          <span className="t-text-body">{String(v)}</span>
        </div>
      ),
    },
    {
      key: 'period', header: t('reports.colPeriod'), sortable: true,
      cellRenderer: (v) => (
        <span className="text-xs font-semibold t-text-2 uppercase tracking-wider">
          {PERIOD_LABEL[v as Period]}
        </span>
      ),
      csvValue: (v) => PERIOD_LABEL[v as Period],
    },
    {
      key: 'date', header: t('reports.colDate'), sortable: true,
      cellRenderer: (v) => <span className="t-text-2 tabular-nums">{formatDate(String(v))}</span>,
    },
    {
      key: 'amount', header: t('reports.colAmount'), sortable: true, align: 'right',
      cellRenderer: (v) => (
        <span className="t-text tabular-nums font-semibold">
          {fmtAmount.format(Number(v))} {operational.currencySymbol}
        </span>
      ),
    },
    {
      key: 'status', header: t('reports.colStatus'), sortable: true, align: 'center',
      cellRenderer: (v) => {
        const s = STATUS_BADGE[v as Report['status']];
        return (
          <span className={cn('inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase', s.classes)}>
            {s.label}
          </span>
        );
      },
      csvValue: (v) => STATUS_BADGE[v as Report['status']].label,
    },
  ];

  const rowActions: RowAction<Report>[] = [
    {
      label:    t('reports.actionView'),
      icon:     <Eye className="w-3.5 h-3.5" aria-hidden="true" />,
      onClick:  (row) => setSelected(row),
      disabled: (row) => row.status !== 'ready',
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold t-text">{t('reports.title')}</h1>
          <p className="text-sm t-text-2 mt-1">{t('reports.subtitle')}</p>
        </div>

        <div
          role="tablist"
          aria-label={t('reports.filterLabel')}
          className="inline-flex items-center gap-1 rounded-lg p-1 t-card-bordered overflow-x-auto max-w-full"
        >
          <Calendar className="w-4 h-4 t-text-3 ml-2 shrink-0" aria-hidden="true" />
          {(['all', 'daily', 'weekly', 'monthly'] as const).map(p => {
            const active = periodFilter === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriodFilter(p)}
                className={cn(
                  'shrink-0 whitespace-nowrap text-xs font-semibold px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                  active ? 'bg-teal-600 text-white' : 't-text-body hover:bg-gray-100 dark:hover:bg-slate-800',
                )}
              >
                {PERIOD_LABEL[p]}
              </button>
            );
          })}
        </div>
      </header>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 text-center py-4" role="alert">{error}</p>
      )}

      <DataTableMaster<Report>
        columns={columns}
        data={visibleReports}
        rowActions={rowActions}
        onRowClick={(row) => setSelected(row)}
        defaultSort={{ key: 'date', dir: 'desc' }}
        exportFormats={['csv', 'json']}
        exportFilename="reports"
        searchPlaceholder={t('reports.searchPlaceholder')}
        emptyMessage={loading ? t('common.loading') : t('reports.empty')}
      />

      {selected && (
        <Dialog
          open
          onOpenChange={(o) => { if (!o) setSelected(null); }}
          title={selected.title}
          description={`${PERIOD_LABEL[selected.period]} · ${formatDate(selected.date)}`}
          size="lg"
        >
          <div className="px-6 pb-6 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={cn(
                'inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase',
                STATUS_BADGE[selected.status].classes,
              )}>
                {STATUS_BADGE[selected.status].label}
              </span>
              <Badge size="sm" variant="outline">{PERIOD_LABEL[selected.period]}</Badge>
              <span className="text-xs t-text-3 tabular-nums font-mono ml-auto">
                {fmtAmount.format(selected.amount)} {operational.currencySymbol}
              </span>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide t-text-3">{t('reports.colDate')}</dt>
                <dd className="mt-1 text-sm font-medium t-text tabular-nums">{formatDate(selected.date)}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-wide t-text-3">{t('reports.colAmount')}</dt>
                <dd className="mt-1 text-sm font-medium t-text">
                  {fmtAmount.format(selected.amount)} {operational.currencySymbol}
                </dd>
              </div>
            </dl>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4">
              <p className="text-sm t-text-2 italic">{t('reports.previewPlaceholder')}</p>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setSelected(null)}>
                {t('reports.close')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
