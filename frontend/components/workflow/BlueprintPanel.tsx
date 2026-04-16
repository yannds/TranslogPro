/**
 * BlueprintPanel — Import/Export JSON + navigateur marketplace
 *
 * Onglets :
 *   1. Marketplace — liste des blueprints publics + système
 *   2. Export       — télécharger le graphe actuel en JSON signé
 *   3. Import       — coller/charger un JSON exporté
 */
import { useState, useCallback, useRef } from 'react';
import type { WorkflowGraph, BlueprintSummary } from './types';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useI18n } from '../../lib/i18n/useI18n';

interface BlueprintPanelProps {
  tenantId:      string;
  currentGraph?: WorkflowGraph;
  className?:    string;
  onInstall:     (blueprintId: string) => Promise<void>;
}

type Tab = 'marketplace' | 'export' | 'import';

export function BlueprintPanel({
  tenantId,
  currentGraph,
  className,
  onInstall,
}: BlueprintPanelProps) {
  const [tab,        setTab]        = useState<Tab>('marketplace');
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([]);
  const [loadingBps, setLoadingBps] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [importJson, setImportJson] = useState('');
  const [importName, setImportName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg,  setImportMsg]  = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ─── Marketplace ───────────────────────────────────────────────────────────

  const loadMarketplace = useCallback(async (entityType?: string) => {
    setLoadingBps(true);
    setError(null);
    try {
      const url = `/api/tenants/${tenantId}/workflow-studio/blueprints` +
        (entityType ? `?entityType=${encodeURIComponent(entityType)}` : '');
      const data = await apiFetch<BlueprintSummary[]>(url);
      setBlueprints(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingBps(false);
    }
  }, [tenantId]);

  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    if (t === 'marketplace' && blueprints.length === 0) loadMarketplace();
  }, [blueprints.length, loadMarketplace]);

  const handleInstall = useCallback(async (id: string) => {
    setInstalling(id);
    try { await onInstall(id); }
    catch (e) { setError((e as Error).message); }
    finally { setInstalling(null); }
  }, [onInstall]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    if (!currentGraph) return;
    const blob = new Blob([JSON.stringify(currentGraph, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${currentGraph.entityType.toLowerCase()}-workflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [currentGraph]);

  // ─── Import ────────────────────────────────────────────────────────────────

  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setImportJson(ev.target?.result as string ?? '');
      setImportName(file.name.replace(/\.json$/, ''));
    };
    reader.readAsText(file);
  }, []);

  const handleImport = useCallback(async () => {
    setImportBusy(true);
    setImportMsg(null);
    setError(null);
    try {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(importJson); }
      catch { throw new Error('JSON invalide'); }

      await apiFetch(`/api/tenants/${tenantId}/workflow-marketplace/blueprints/import`, {
        method: 'POST',
        body:   {
          graphJson: parsed,
          checksum:  (parsed as Record<string, unknown>)['checksum'] ?? '',
          name:      importName || undefined,
        },
      });

      setImportMsg('Blueprint importé avec succès. Rechargez la marketplace pour le voir.');
      setImportJson('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }, [tenantId, importJson, importName]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: 'marketplace', label: 'Marketplace' },
    { id: 'export',      label: 'Exporter' },
    { id: 'import',      label: 'Importer' },
  ];

  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)}>
      {/* Onglets */}
      <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={cn(
              'flex-1 rounded-md py-1 text-xs font-medium transition-colors',
              tab === t.id
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Marketplace ── */}
      {tab === 'marketplace' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">Blueprints disponibles</span>
            <button
              onClick={() => loadMarketplace()}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
            >
              ↺ Rafraîchir
            </button>
          </div>

          {loadingBps ? (
            <div className="flex justify-center py-6 text-slate-400">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
            </div>
          ) : blueprints.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Aucun blueprint disponible
            </div>
          ) : (
            <div className="space-y-1.5">
              {blueprints.map(bp => (
                <div
                  key={bp.id}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-800 dark:text-slate-100 text-xs truncate">
                          {bp.name}
                        </span>
                        {bp.isSystem && (
                          <span className="rounded bg-amber-100 dark:bg-amber-900 px-1 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-200">
                            SYSTÈME
                          </span>
                        )}
                        {bp.isPublic && !bp.isSystem && (
                          <span className="rounded bg-blue-100 dark:bg-blue-900 px-1 py-0.5 text-[9px] text-blue-600 dark:text-blue-300">
                            PUBLIC
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {bp.entityType} · v{bp.version}
                        {bp._count && ` · ${bp._count.installs} install${bp._count.installs !== 1 ? 's' : ''}`}
                      </div>
                      {bp.description && (
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                          {bp.description}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleInstall(bp.id)}
                      disabled={installing === bp.id}
                      className="shrink-0 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium px-2 py-1 disabled:opacity-50 transition-colors"
                    >
                      {installing === bp.id ? '...' : '↓ Installer'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Export ── */}
      {tab === 'export' && (
        <div className="space-y-3">
          {currentGraph ? (
            <>
              <div className="rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs space-y-1">
                <div className="font-semibold text-slate-700 dark:text-slate-200">Graphe courant</div>
                <div className="text-slate-500">entityType : <span className="font-mono">{currentGraph.entityType}</span></div>
                <div className="text-slate-500">États : {currentGraph.nodes.length}</div>
                <div className="text-slate-500">Transitions : {currentGraph.edges.length}</div>
                <div className="text-slate-500 font-mono truncate text-[9px]">checksum : {currentGraph.checksum || '(non calculé)'}</div>
              </div>
              <button
                onClick={handleExport}
                className="w-full rounded-md bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-xs font-medium py-2 hover:bg-slate-700 dark:hover:bg-slate-200 transition-colors"
              >
                ↓ Télécharger JSON
              </button>
            </>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              Sélectionnez un entityType pour exporter son graphe
            </div>
          )}
        </div>
      )}

      {/* ── Import ── */}
      {tab === 'import' && (
        <div className="space-y-3">
          {importMsg && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
              {importMsg}
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-500 mb-1">Nom du blueprint (optionnel)</label>
            <input
              type="text"
              value={importName}
              onChange={e => setImportName(e.target.value)}
              placeholder="Mon workflow importé"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Fichier JSON</label>
            <input ref={fileRef} type="file" accept=".json" onChange={handleFileLoad} className="hidden" />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-md border-2 border-dashed border-slate-300 dark:border-slate-600 py-3 text-xs text-slate-500 hover:border-slate-400 transition-colors"
            >
              Cliquer pour charger un fichier .json
            </button>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Ou coller le JSON ici</label>
            <textarea
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              rows={5}
              placeholder='{"entityType":"Ticket","nodes":[...],"edges":[...],...}'
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono resize-none"
            />
          </div>

          <button
            onClick={handleImport}
            disabled={importBusy || !importJson.trim()}
            className="w-full rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 disabled:opacity-50 transition-colors"
          >
            {importBusy ? 'Import en cours...' : '↑ Importer'}
          </button>
        </div>
      )}
    </div>
  );
}
