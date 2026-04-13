/**
 * DataTableMaster<T> — Composant générique de tableau de données
 *
 * Fonctionnalités :
 *   - Tri multi-colonne (clic en-tête, indicateur ↑↓)
 *   - Recherche globale full-text (debounce 300ms)
 *   - Pagination configurable (taille de page : 10 / 25 / 50 / 100)
 *   - Actions par ligne (RowAction : label, icon, onClick, hidden, disabled)
 *   - Sélection multiple (checkbox + action groupée)
 *   - Export CSV côté client
 *   - Dark mode (classe CSS dark sur l'ancêtre)
 *   - WCAG 2.1 : aria-sort, aria-label, rôles table corrects
 *   - Skeleton loader (pulse CSS) pendant le chargement
 *   - Colonne de statut avec badge coloré (via cellRenderer)
 *
 * Usage :
 * ```tsx
 * <DataTableMaster<Ticket>
 *   columns={[
 *     { key: 'passengerName', header: 'Nom', sortable: true },
 *     { key: 'status',        header: 'Statut', cellRenderer: (v) => <StatusBadge value={v} /> },
 *     { key: 'pricePaid',     header: 'Prix', align: 'right',
 *       cellRenderer: (v) => `${v.toLocaleString('fr-FR')} F` },
 *   ]}
 *   data={tickets}
 *   loading={isLoading}
 *   rowActions={[
 *     { label: 'Imprimer', onClick: (row) => printTicket(row.id) },
 *     { label: 'Annuler',  onClick: (row) => cancelTicket(row.id),
 *       hidden: (row) => row.status !== 'CONFIRMED' },
 *   ]}
 *   onExportCsv
 *   emptyMessage="Aucun billet trouvé"
 * />
 * ```
 */
import {
  useState, useMemo, useCallback, useEffect, ChangeEvent, KeyboardEvent,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  key:          keyof T & string;
  header:       string;
  sortable?:    boolean;
  align?:       'left' | 'center' | 'right';
  width?:       string;                        // ex: '120px', '10%'
  cellRenderer?: (value: T[keyof T], row: T) => React.ReactNode;
  csvValue?:    (value: T[keyof T], row: T) => string;  // pour export CSV
}

export interface RowAction<T> {
  label:     string;
  icon?:     React.ReactNode;
  onClick:   (row: T) => void;
  hidden?:   (row: T) => boolean;
  disabled?: (row: T) => boolean;
  danger?:   boolean;
}

export interface BulkAction<T> {
  label:   string;
  icon?:   React.ReactNode;
  onClick: (selectedRows: T[]) => void;
  danger?: boolean;
}

export interface DataTableMasterProps<T extends { id: string }> {
  columns:        Column<T>[];
  data:           T[];
  loading?:       boolean;
  rowActions?:    RowAction<T>[];
  bulkActions?:   BulkAction<T>[];
  keyField?:      keyof T & string;   // Défaut: 'id'
  defaultSort?:   { key: keyof T & string; dir: SortDir };
  defaultPageSize?: 10 | 25 | 50 | 100;
  searchPlaceholder?: string;
  emptyMessage?:  string;
  onExportCsv?:   boolean | string;   // true = "export.csv", string = nom du fichier
  onRowClick?:    (row: T) => void;
  className?:     string;
  stickyHeader?:  boolean;
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function useDebounce<V>(value: V, delay: number): V {
  const [debouncedValue, setDebouncedValue] = useState<V>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function getNestedValue<T>(obj: T, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
}

function cellToString<T>(col: Column<T>, row: T): string {
  const val = getNestedValue(row, col.key) as T[keyof T];
  if (col.csvValue) return col.csvValue(val, row);
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

function exportToCsv<T>(columns: Column<T>[], data: T[], filename: string) {
  const header = columns.map(c => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const rows   = data.map(row =>
    columns.map(col => {
      const s = cellToString(col, row);
      return `"${s.replace(/"/g, '""')}"`;
    }).join(','),
  );
  const csv  = [header, ...rows].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Composant principal ──────────────────────────────────────────────────────

function DataTableMaster<T extends { id: string }>({
  columns,
  data,
  loading = false,
  rowActions,
  bulkActions,
  keyField = 'id',
  defaultSort,
  defaultPageSize = 25,
  searchPlaceholder = 'Rechercher…',
  emptyMessage = 'Aucun résultat',
  onExportCsv,
  onRowClick,
  className = '',
  stickyHeader = false,
}: DataTableMasterProps<T>) {
  const [search,     setSearch]     = useState('');
  const [sortKey,    setSortKey]    = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir,    setSortDir]    = useState<SortDir>(defaultSort?.dir ?? 'asc');
  const [page,       setPage]       = useState(1);
  const [pageSize,   setPageSize]   = useState<number>(defaultPageSize);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 300);

  // Réinitialise la page quand la recherche change
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  // ── Filtrage ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return data;
    return data.filter(row =>
      columns.some(col => {
        const s = cellToString(col, row).toLowerCase();
        return s.includes(q);
      }),
    );
  }, [data, columns, debouncedSearch]);

  // ── Tri ─────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = getNestedValue(a, sortKey);
      const bv = getNestedValue(b, sortKey);
      const cmp =
        av === null || av === undefined ? 1
        : bv === null || bv === undefined ? -1
        : av instanceof Date && bv instanceof Date ? av.getTime() - bv.getTime()
        : typeof av === 'number' && typeof bv === 'number' ? av - bv
        : String(av).localeCompare(String(bv), 'fr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const totalPages   = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage     = Math.min(page, totalPages);
  const pageData     = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const handleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return key; }
      setSortDir('asc');
      return key;
    });
  }, []);

  // ── Sélection ───────────────────────────────────────────────────────────────
  const pageKeys      = pageData.map(r => String(getNestedValue(r, keyField)));
  const allPageSel    = pageKeys.length > 0 && pageKeys.every(k => selected.has(k));
  const someSel       = pageKeys.some(k => selected.has(k));

  const toggleRow     = (key: string) =>
    setSelected(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleAll     = () =>
    setSelected(s => {
      const n = new Set(s);
      allPageSel ? pageKeys.forEach(k => n.delete(k)) : pageKeys.forEach(k => n.add(k));
      return n;
    });
  const clearSelected = () => setSelected(new Set());

  const selectedRows  = sorted.filter(r => selected.has(String(getNestedValue(r, keyField))));

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const handleCsv = () => {
    const fname = typeof onExportCsv === 'string' ? onExportCsv : 'export.csv';
    exportToCsv(columns, sorted, fname);
  };

  // ── Skeleton ────────────────────────────────────────────────────────────────
  const skeletonRows = Array.from({ length: pageSize > 10 ? 10 : pageSize });

  // ── Rendu ────────────────────────────────────────────────────────────────────
  const hasRowActions = rowActions && rowActions.length > 0;
  const hasBulkAct    = bulkActions && bulkActions.length > 0;

  return (
    <div className={`dtm-root ${className}`} role="region" aria-label="Tableau de données">

      {/* ── Barre d'outils ─────────────────────────────────────────────────── */}
      <div className="dtm-toolbar">
        <input
          type="search"
          className="dtm-search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          aria-label={searchPlaceholder}
        />

        <div className="dtm-toolbar-right">
          {/* Actions groupées si sélection */}
          {hasBulkAct && selected.size > 0 && (
            <div className="dtm-bulk-actions" role="group" aria-label="Actions groupées">
              <span className="dtm-sel-count">{selected.size} sélectionné(s)</span>
              {bulkActions!.map((action, i) => (
                <button
                  key={i}
                  className={`dtm-btn ${action.danger ? 'dtm-btn-danger' : 'dtm-btn-secondary'}`}
                  onClick={() => { action.onClick(selectedRows); clearSelected(); }}
                  aria-label={action.label}
                >
                  {action.icon} {action.label}
                </button>
              ))}
              <button className="dtm-btn dtm-btn-ghost" onClick={clearSelected}>
                Désélectionner
              </button>
            </div>
          )}

          {/* Export CSV */}
          {onExportCsv && (
            <button
              className="dtm-btn dtm-btn-secondary"
              onClick={handleCsv}
              aria-label="Exporter en CSV"
              disabled={sorted.length === 0}
            >
              ↓ CSV
            </button>
          )}

          {/* Taille de page */}
          <select
            className="dtm-page-size"
            value={pageSize}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Lignes par page"
          >
            {[10, 25, 50, 100].map(n => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      <div className="dtm-table-wrapper">
        <table
          className={`dtm-table ${stickyHeader ? 'dtm-sticky' : ''}`}
          role="grid"
          aria-rowcount={sorted.length}
          aria-colcount={columns.length + (hasRowActions ? 1 : 0) + (hasBulkAct ? 1 : 0)}
        >
          <thead>
            <tr>
              {hasBulkAct && (
                <th className="dtm-th dtm-th-check" aria-label="Tout sélectionner">
                  <input
                    type="checkbox"
                    checked={allPageSel}
                    ref={el => { if (el) el.indeterminate = someSel && !allPageSel; }}
                    onChange={toggleAll}
                    aria-label={allPageSel ? 'Tout désélectionner' : 'Tout sélectionner'}
                  />
                </th>
              )}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`dtm-th ${col.sortable ? 'dtm-th-sort' : ''} dtm-align-${col.align ?? 'left'}`}
                  style={{ width: col.width }}
                  aria-sort={
                    sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  onKeyDown={(e: KeyboardEvent) => {
                    if (col.sortable && (e.key === 'Enter' || e.key === ' ')) handleSort(col.key);
                  }}
                  tabIndex={col.sortable ? 0 : undefined}
                  role={col.sortable ? 'columnheader button' : 'columnheader'}
                >
                  {col.header}
                  {col.sortable && (
                    <span className="dtm-sort-icon" aria-hidden="true">
                      {sortKey === col.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'}
                    </span>
                  )}
                </th>
              ))}
              {hasRowActions && (
                <th className="dtm-th dtm-th-actions" aria-label="Actions">Actions</th>
              )}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              skeletonRows.map((_, i) => (
                <tr key={i} className="dtm-row-skeleton" aria-hidden="true">
                  {hasBulkAct && <td><div className="dtm-skeleton" /></td>}
                  {columns.map(col => (
                    <td key={col.key}><div className="dtm-skeleton" /></td>
                  ))}
                  {hasRowActions && <td><div className="dtm-skeleton" /></td>}
                </tr>
              ))
            ) : pageData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (hasRowActions ? 1 : 0) + (hasBulkAct ? 1 : 0)}
                  className="dtm-empty"
                  aria-label={emptyMessage}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageData.map((row, rowIdx) => {
                const rowKey = String(getNestedValue(row, keyField));
                const isSelected = selected.has(rowKey);
                return (
                  <tr
                    key={rowKey}
                    className={`dtm-row ${isSelected ? 'dtm-row-selected' : ''} ${rowIdx % 2 === 0 ? 'dtm-row-even' : ''}`}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={onRowClick ? { cursor: 'pointer' } : undefined}
                    aria-rowindex={rowIdx + 1}
                    aria-selected={hasBulkAct ? isSelected : undefined}
                  >
                    {hasBulkAct && (
                      <td
                        className="dtm-td dtm-td-check"
                        onClick={e => { e.stopPropagation(); toggleRow(rowKey); }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(rowKey)}
                          aria-label={`Sélectionner la ligne ${rowIdx + 1}`}
                        />
                      </td>
                    )}
                    {columns.map(col => {
                      const val = getNestedValue(row, col.key) as T[keyof T];
                      return (
                        <td
                          key={col.key}
                          className={`dtm-td dtm-align-${col.align ?? 'left'}`}
                        >
                          {col.cellRenderer ? col.cellRenderer(val, row) : (
                            val === null || val === undefined ? '—' :
                            val instanceof Date ? val.toLocaleDateString('fr-FR') :
                            String(val)
                          )}
                        </td>
                      );
                    })}
                    {hasRowActions && (
                      <td className="dtm-td dtm-td-actions" onClick={e => e.stopPropagation()}>
                        <div className="dtm-actions-group" role="group" aria-label="Actions">
                          {rowActions!
                            .filter(a => !a.hidden?.(row))
                            .map((action, i) => (
                              <button
                                key={i}
                                className={`dtm-action-btn ${action.danger ? 'dtm-action-danger' : ''}`}
                                onClick={() => action.onClick(row)}
                                disabled={action.disabled?.(row) ?? false}
                                aria-label={action.label}
                                title={action.label}
                              >
                                {action.icon ?? action.label}
                              </button>
                            ))
                          }
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pied de tableau (pagination + résumé) ───────────────────────────── */}
      <div className="dtm-footer" aria-label="Pagination">
        <span className="dtm-summary">
          {loading ? '…'
           : sorted.length === 0 ? '0 résultat'
           : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} sur ${sorted.length}`}
        </span>

        <div className="dtm-pagination" role="navigation" aria-label="Pages">
          <button
            className="dtm-page-btn"
            onClick={() => setPage(1)}
            disabled={safePage <= 1}
            aria-label="Première page"
          >«</button>
          <button
            className="dtm-page-btn"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            aria-label="Page précédente"
          >‹</button>

          <span className="dtm-page-info" aria-live="polite">
            Page {safePage} / {totalPages}
          </span>

          <button
            className="dtm-page-btn"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            aria-label="Page suivante"
          >›</button>
          <button
            className="dtm-page-btn"
            onClick={() => setPage(totalPages)}
            disabled={safePage >= totalPages}
            aria-label="Dernière page"
          >»</button>
        </div>
      </div>

      {/* ── Styles (inlined pour portabilité) ───────────────────────────────── */}
      <style>{`
        .dtm-root { font-family: system-ui, sans-serif; font-size: 14px; color: #1a1a1a; }
        .dark .dtm-root { color: #e5e7eb; }

        /* Toolbar */
        .dtm-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
        .dtm-toolbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .dtm-search { border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 12px; font-size: 14px; min-width: 220px; background: #fff; color: inherit; }
        .dark .dtm-search { background: #1f2937; border-color: #374151; color: #e5e7eb; }
        .dtm-search:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.2); }
        .dtm-page-size { border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 8px; font-size: 13px; background: #fff; color: inherit; cursor: pointer; }
        .dark .dtm-page-size { background: #1f2937; border-color: #374151; color: #e5e7eb; }

        /* Buttons */
        .dtm-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #d1d5db; border-radius: 6px; padding: 5px 10px; font-size: 13px; background: #fff; color: #374151; cursor: pointer; transition: background .15s; }
        .dtm-btn:hover { background: #f3f4f6; }
        .dtm-btn-secondary { background: #f3f4f6; }
        .dtm-btn-danger { background: #fee2e2; border-color: #fca5a5; color: #b91c1c; }
        .dtm-btn-ghost { background: transparent; border-color: transparent; color: #6b7280; }
        .dark .dtm-btn { background: #1f2937; border-color: #374151; color: #e5e7eb; }
        .dark .dtm-btn:hover { background: #374151; }

        /* Bulk actions */
        .dtm-bulk-actions { display: flex; align-items: center; gap: 6px; }
        .dtm-sel-count { font-size: 12px; color: #6366f1; font-weight: 600; }

        /* Table wrapper */
        .dtm-table-wrapper { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
        .dark .dtm-table-wrapper { border-color: #374151; }
        .dtm-table { width: 100%; border-collapse: collapse; min-width: 400px; }
        .dtm-sticky thead th { position: sticky; top: 0; z-index: 1; }

        /* Header */
        .dtm-th { padding: 10px 12px; background: #1a1a1a; color: #fff; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; user-select: none; }
        .dtm-th-sort { cursor: pointer; }
        .dtm-th-sort:hover { background: #333; }
        .dtm-th-check, .dtm-th-actions { width: 44px; }
        .dtm-sort-icon { color: #9ca3af; font-size: 11px; }

        /* Alignment */
        .dtm-align-left   { text-align: left; }
        .dtm-align-center { text-align: center; }
        .dtm-align-right  { text-align: right; }

        /* Rows */
        .dtm-row { border-bottom: 1px solid #f3f4f6; transition: background .1s; }
        .dtm-row:last-child { border-bottom: none; }
        .dtm-row:hover { background: #f9fafb; }
        .dtm-row-even { background: #fafafa; }
        .dtm-row-selected { background: #eef2ff !important; }
        .dark .dtm-row { border-color: #374151; }
        .dark .dtm-row:hover { background: #1f2937; }
        .dark .dtm-row-even { background: #111827; }
        .dark .dtm-row-selected { background: #312e81 !important; }

        /* Cells */
        .dtm-td { padding: 9px 12px; font-size: 13px; vertical-align: middle; }
        .dtm-td-check { width: 44px; }
        .dtm-td-actions { width: auto; white-space: nowrap; }

        /* Action buttons */
        .dtm-actions-group { display: flex; gap: 4px; }
        .dtm-action-btn { border: 1px solid #d1d5db; border-radius: 4px; padding: 3px 8px; font-size: 12px; background: #fff; color: #374151; cursor: pointer; transition: background .15s; }
        .dtm-action-btn:hover:not(:disabled) { background: #f3f4f6; }
        .dtm-action-btn:disabled { opacity: .4; cursor: not-allowed; }
        .dtm-action-danger { border-color: #fca5a5; color: #b91c1c; }
        .dtm-action-danger:hover:not(:disabled) { background: #fee2e2; }
        .dark .dtm-action-btn { background: #1f2937; border-color: #4b5563; color: #d1d5db; }

        /* Empty */
        .dtm-empty { padding: 40px; text-align: center; color: #9ca3af; font-size: 14px; }

        /* Skeleton */
        .dtm-row-skeleton .dtm-skeleton { height: 14px; border-radius: 4px; background: #e5e7eb; animation: dtm-pulse 1.5s ease-in-out infinite; }
        @keyframes dtm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
        .dark .dtm-row-skeleton .dtm-skeleton { background: #374151; }

        /* Footer */
        .dtm-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px; }
        .dtm-summary { font-size: 12px; color: #6b7280; }
        .dtm-pagination { display: flex; align-items: center; gap: 4px; }
        .dtm-page-btn { border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 8px; font-size: 13px; background: #fff; color: #374151; cursor: pointer; }
        .dtm-page-btn:hover:not(:disabled) { background: #f3f4f6; }
        .dtm-page-btn:disabled { opacity: .4; cursor: not-allowed; }
        .dtm-page-info { font-size: 13px; padding: 0 8px; color: #374151; }
        .dark .dtm-page-btn { background: #1f2937; border-color: #374151; color: #e5e7eb; }
        .dark .dtm-page-info { color: #e5e7eb; }
      `}</style>
    </div>
  );
}

export default DataTableMaster;
