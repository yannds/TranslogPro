/**
 * PageReports — Rapports périodiques (journalier, hebdo, mensuel).
 *
 * Future intégration : GET /api/v1/tenants/:id/reports
 *
 * Utilise DataTableMaster (obligatoire pour toute liste/table).
 * UI : tokens sémantiques, compat light/dark, WCAG 2.1 AA.
 */
import { useMemo, useState } from 'react';
import { FileBarChart, Download, Eye, Calendar } from 'lucide-react';
import DataTableMaster from '../DataTableMaster';
import type { Column, RowAction } from '../DataTableMaster';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn }      from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = 'daily' | 'weekly' | 'monthly';

interface Report {
  id:       string;
  title:    string;
  period:   Period;
  date:     string;           // ISO 'YYYY-MM-DD'
  author:   string;
  size:     string;           // '182 KB'
  status:   'ready' | 'generating' | 'error';
}

// ─── Données mock ─────────────────────────────────────────────────────────────

const REPORTS: Report[] = [
  { id: 'r1', title: 'Journal de caisse — 17 avr. 2026', period: 'daily',   date: '2026-04-17', author: 'Sylvère Makosso',  size: '124 KB', status: 'ready' },
  { id: 'r2', title: 'Rapport hebdo ventes — S15',        period: 'weekly',  date: '2026-04-13', author: 'Marie Nzila',      size: '312 KB', status: 'ready' },
  { id: 'r3', title: 'Mensuel Mars 2026',                  period: 'monthly', date: '2026-04-01', author: 'Jean Koffi',       size: '1.1 MB', status: 'ready' },
  { id: 'r4', title: 'Journal SAV — 17 avr.',              period: 'daily',   date: '2026-04-17', author: 'Clarisse Mboungou',size: '68 KB',  status: 'ready' },
  { id: 'r5', title: 'Rapport flotte — S15',              period: 'weekly',  date: '2026-04-13', author: 'Jean Koffi',       size: '256 KB', status: 'generating' },
  { id: 'r6', title: 'Mensuel Colis — Mars',              period: 'monthly', date: '2026-04-01', author: 'Marie Nzila',      size: '482 KB', status: 'ready' },
  { id: 'r7', title: 'Journal retards — 16 avr.',         period: 'daily',   date: '2026-04-16', author: 'Sylvère Makosso',  size: '88 KB',  status: 'ready' },
  { id: 'r8', title: 'Rapport fréquentation S14',         period: 'weekly',  date: '2026-04-06', author: 'Jean Koffi',       size: '298 KB', status: 'error' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageReports() {
  const { t, dateLocale } = useI18n();
  const [periodFilter, setPeriodFilter] = useState<'all' | Period>('all');

  const PERIOD_LABEL: Record<'all' | Period, string> = {
    all:     t('reports.filterAll'),
    daily:   t('reports.periodDaily'),
    weekly:  t('reports.periodWeekly'),
    monthly: t('reports.periodMonthly'),
  };

  const STATUS_BADGE: Record<Report['status'], { label: string; classes: string }> = {
    ready:      { label: t('reports.statusReady'),      classes: 't-delta-up' },
    generating: { label: t('reports.statusGenerating'), classes: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
    error:      { label: t('reports.statusError'),      classes: 't-delta-down' },
  };

  const visibleReports = useMemo(
    () => periodFilter === 'all' ? REPORTS : REPORTS.filter(r => r.period === periodFilter),
    [periodFilter],
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' });

  const columns: Column<Report>[] = [
    {
      key: 'title', header: t('reports.colTitle'), sortable: true,
      cellRenderer: (v, row) => (
        <div className="flex items-center gap-2">
          <FileBarChart className="w-4 h-4 t-text-3 shrink-0" aria-hidden="true" />
          <span className="t-text-body">{String(v)}</span>
          <span className="text-[10px] t-text-3 font-mono">{row.size}</span>
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
      key: 'author', header: t('reports.colAuthor'), sortable: true,
      cellRenderer: (v) => <span className="t-text-body">{String(v)}</span>,
    },
    {
      key: 'status', header: t('reports.colStatus'), sortable: true, align: 'center',
      cellRenderer: (v) => {
        const s = STATUS_BADGE[v as Report['status']];
        return <span className={cn('inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase', s.classes)}>{s.label}</span>;
      },
      csvValue: (v) => STATUS_BADGE[v as Report['status']].label,
    },
  ];

  const rowActions: RowAction<Report>[] = [
    {
      label: t('reports.actionView'),
      icon: <Eye className="w-3.5 h-3.5" aria-hidden="true" />,
      onClick: () => { /* future : open preview */ },
      disabled: (row) => row.status !== 'ready',
    },
    {
      label: t('reports.actionDownload'),
      icon: <Download className="w-3.5 h-3.5" aria-hidden="true" />,
      onClick: () => { /* future : trigger download */ },
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

      <DataTableMaster<Report>
        columns={columns}
        data={visibleReports}
        rowActions={rowActions}
        defaultSort={{ key: 'date', dir: 'desc' }}
        exportFormats={['csv', 'json']}
        exportFilename="reports"
        searchPlaceholder={t('reports.searchPlaceholder')}
        emptyMessage={t('reports.empty')}
      />
    </div>
  );
}
