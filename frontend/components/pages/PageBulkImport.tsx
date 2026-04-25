/**
 * PageBulkImport — Import groupé (gares, véhicules, personnel, chauffeurs)
 *
 * Endpoints :
 *   GET  /api/tenants/:tid/bulk-import/template/:entity   → télécharge le .xlsx
 *   POST /api/tenants/:tid/bulk-import/import/:entity     → multipart/form-data "file"
 *
 * Permission : control.bulk.import.tenant
 */
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload, Download, CheckCircle2, AlertTriangle, RotateCcw } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { cn } from '../../lib/utils';
import DataTableMaster, { type Column } from '../DataTableMaster';

// ── Types ─────────────────────────────────────────────────────────────────────

type BulkEntity = 'stations' | 'vehicles' | 'staff' | 'drivers';

interface ImportError {
  row:     number;
  field?:  string;
  message: string;
}

interface ImportResult {
  total:   number;
  created: number;
  updated: number;
  skipped: number;
  errors:  ImportError[];
}

// ── Constantes ────────────────────────────────────────────────────────────────

const TABS: { id: BulkEntity; labelKey: string }[] = [
  { id: 'stations', labelKey: 'bulkImport.tabStations' },
  { id: 'vehicles', labelKey: 'bulkImport.tabVehicles' },
  { id: 'staff',    labelKey: 'bulkImport.tabStaff' },
  { id: 'drivers',  labelKey: 'bulkImport.tabDrivers' },
];

// ── Composant ─────────────────────────────────────────────────────────────────

export function PageBulkImport() {
  const { user }  = useAuth();
  const { t }     = useI18n();
  const tenantId  = user?.tenantId ?? '';
  const base      = `/api/tenants/${tenantId}/bulk-import`;

  const [activeTab,  setActiveTab]  = useState<BulkEntity>('stations');
  const [file,       setFile]       = useState<File | null>(null);
  const [dragging,   setDragging]   = useState(false);
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [apiError,   setApiError]   = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Colonnes DataTableMaster — erreurs d'import ───────────────────────────
  const errorColumns: Column<ImportError & { id: string }>[] = [
    {
      key: 'row', header: t('bulkImport.colRow'), sortable: true, width: '90px', align: 'right',
      cellRenderer: (v) => <span className="text-gray-700 dark:text-gray-300 font-mono">{String(v)}</span>,
    },
    {
      key: 'field', header: t('bulkImport.colField'), sortable: true, width: '180px',
      cellRenderer: (v) => <span className="text-gray-500 dark:text-gray-400">{(v as string | undefined) ?? '—'}</span>,
    },
    {
      key: 'message', header: t('common.description'), sortable: false,
      cellRenderer: (v) => <span className="text-red-700 dark:text-red-400">{String(v)}</span>,
    },
  ];

  // ── Handlers ─────────────────────────────────────────────────────────────

  function selectTab(id: BulkEntity) {
    setActiveTab(id);
    resetState();
  }

  function resetState() {
    setFile(null);
    setResult(null);
    setApiError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function downloadTemplate() {
    try {
      const response = await fetch(`${base}/template/${activeTab}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `template_${activeTab}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setApiError('Erreur inattendue');
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) { setFile(f); setResult(null); setApiError(null); }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) { setFile(f); setResult(null); setApiError(null); }
  }

  async function runImport() {
    if (!file || !tenantId) return;
    setImporting(true);
    setApiError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${base}/import/${activeTab}`, {
        method:      'POST',
        credentials: 'include',
        body:        form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg  = (body as { message?: string }).message ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const data = await res.json() as ImportResult;
      setResult(data);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : t('common.unexpectedError'));
    } finally {
      setImporting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('bulkImport.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('bulkImport.pageDesc')}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-t-md transition-colors',
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-800 border border-b-0 border-gray-200 dark:border-gray-700 text-teal-600 dark:text-teal-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200',
            )}
            aria-selected={activeTab === tab.id}
            role="tab"
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Main panel */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-6">

        {/* Instructions */}
        <details className="group" open>
          <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300 list-none flex items-center gap-2">
            <span className="text-teal-600 dark:text-teal-400">①</span>
            {t('bulkImport.instructions')}
          </summary>
          <ol className="mt-3 ml-4 space-y-1 list-decimal text-sm text-gray-600 dark:text-gray-400">
            <li>{t('bulkImport.instr1')}</li>
            <li>{t('bulkImport.instr2')}</li>
            <li>{t('bulkImport.instr3')}</li>
            <li>{t('bulkImport.instr4')}</li>
          </ol>
        </details>

        {/* Step 1 — Download template */}
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <span className="mr-1 text-teal-600 dark:text-teal-400">①</span>
            {t('bulkImport.downloadTemplate')}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { void downloadTemplate(); }}
            aria-label={t('bulkImport.downloadTemplate')}
          >
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
            {t('bulkImport.downloadTemplate')} — {activeTab}.xlsx
          </Button>
        </div>

        {/* Step 2 — Upload */}
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <span className="mr-1 text-teal-600 dark:text-teal-400">②</span>
            {t('bulkImport.uploadFile')}
          </p>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label={t('bulkImport.dragOrClick')}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer px-6 py-10 transition-colors',
              dragging
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-teal-400 dark:hover:border-teal-500',
            )}
          >
            <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500" aria-hidden="true" />
            {file ? (
              <p className="text-sm text-teal-700 dark:text-teal-300 font-medium">
                {t('bulkImport.fileSelected')}: {file.name}
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                {t('bulkImport.dragOrClick')}
              </p>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-hidden="true"
            onChange={handleFileChange}
          />
        </div>

        {/* Step 3 — Import button */}
        {file && !result && (
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              disabled={importing}
              onClick={() => { void runImport(); }}
              aria-label={t('bulkImport.importBtn')}
            >
              <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
              {importing ? t('bulkImport.importing') : t('bulkImport.importBtn')}
            </Button>
            <button
              type="button"
              className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
              onClick={resetState}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}

        {/* API error */}
        {apiError && <ErrorAlert message={apiError} />}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            {/* Summary */}
            <div className={cn(
              'rounded-lg border p-4 flex items-start gap-3',
              result.errors.length === 0
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
            )}>
              {result.errors.length === 0
                ? <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" aria-hidden="true" />
                : <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" aria-hidden="true" />
              }
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {result.errors.length === 0 ? t('bulkImport.successTitle') : t('bulkImport.errorsTitle')}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t('bulkImport.successSummary')
                    .replace('{{created}}', String(result.created))
                    .replace('{{updated}}', String(result.updated ?? 0))
                    .replace('{{total}}',   String(result.total))
                    .replace('{{skipped}}', String(result.skipped))
                  }
                </p>
              </div>
            </div>

            {/* Error table */}
            {result.errors.length > 0 && (
              <DataTableMaster<ImportError & { id: string }>
                columns={errorColumns}
                data={result.errors.map((e, i) => ({ ...e, id: `err-${i}` }))}
                defaultSort={{ key: 'row', dir: 'asc' }}
                searchPlaceholder={t('bulkImport.searchErrors')}
                emptyMessage={t('bulkImport.successTitle')}
                exportFormats={['csv']}
                exportFilename="bulk-import-errors"
              />
            )}

            {/* Reset */}
            <Button
              variant="outline"
              size="sm"
              onClick={resetState}
              aria-label={t('bulkImport.resetBtn')}
            >
              <RotateCcw className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('bulkImport.resetBtn')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
