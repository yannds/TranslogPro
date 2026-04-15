/**
 * SimulationPanel — Panneau Live-Path
 *
 * Permet de simuler un chemin de transitions sans toucher à la DB.
 *
 * Usage :
 *   <SimulationPanel
 *     tenantId="..."
 *     entityType="Ticket"
 *     nodes={graph.nodes}
 *     onSimResult={(result, overlay) => ...}
 *     onClear={() => ...}
 *   />
 */
import { useState, useCallback } from 'react';
import type { WorkflowNode, SimResult, SimOverlay } from './types';
import { ReactFlowAdapter } from './ReactFlowAdapter';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';

interface SimulationPanelProps {
  tenantId:     string;
  entityType:   string;
  nodes:        WorkflowNode[];
  blueprintId?: string;
  onSimResult:  (result: SimResult, overlay: SimOverlay) => void;
  onClear:      () => void;
  className?:   string;
}

export function SimulationPanel({
  tenantId,
  entityType,
  nodes,
  blueprintId,
  onSimResult,
  onClear,
  className,
}: SimulationPanelProps) {
  const initialStates = nodes.filter(n => n.type === 'initial');
  const [initialState, setInitialState] = useState(initialStates[0]?.id ?? '');
  const [actions, setActions]           = useState('');
  const [context, setContext]           = useState('{}');
  const [roleId,  setRoleId]            = useState('');
  const [result,  setResult]            = useState<SimResult | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error,   setError]             = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const actionList = actions.split(',').map(a => a.trim()).filter(Boolean);
      let ctx: Record<string, unknown> = {};
      try { ctx = JSON.parse(context); } catch { /* keep empty */ }

      const sim = await apiFetch<SimResult>(
        `/api/tenants/${tenantId}/workflow-studio/simulate`,
        {
          method: 'POST',
          body: {
            entityType,
            initialState,
            actions: actionList,
            simulatedRoleId: roleId || undefined,
            context: ctx,
            blueprintId: blueprintId || undefined,
          },
        },
      );

      setResult(sim);
      const overlay = ReactFlowAdapter.buildSimOverlay(sim);
      onSimResult(sim, overlay);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityType, initialState, actions, context, roleId, blueprintId, onSimResult]);

  const handleClear = useCallback(() => {
    setResult(null);
    setError(null);
    onClear();
  }, [onClear]);

  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)}>
      <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
        <span>▶ Simulation Live-Path</span>
        {result && (
          <span className={cn('text-xs rounded-full px-2 py-0.5 font-bold',
            result.steps.every(s => s.reachable)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
              : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-200'
          )}>
            {result.steps.every(s => s.reachable) ? '✓ Succès' : '⛔ Bloqué'}
          </span>
        )}
      </div>

      {/* Config */}
      <div className="space-y-2">
        <div>
          <label className="block text-xs text-slate-500 mb-0.5">État initial</label>
          <select
            value={initialState}
            onChange={e => setInitialState(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
          >
            {nodes.map(n => (
              <option key={n.id} value={n.id}>{n.label} ({n.id})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-0.5">Actions (virgule séparées)</label>
          <input
            type="text"
            value={actions}
            onChange={e => setActions(e.target.value)}
            placeholder="CONFIRM,SCAN,COMPLETE"
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-0.5">Contexte guards (JSON)</label>
          <textarea
            value={context}
            onChange={e => setContext(e.target.value)}
            rows={2}
            placeholder='{"checkSoldeAgent":true,"balance":50000}'
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-500 mb-0.5">Role ID simulé (optionnel)</label>
          <input
            type="text"
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
            placeholder="role-uuid..."
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
          />
        </div>
      </div>

      {/* Boutons */}
      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={loading || !initialState || !actions}
          className="flex-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Simulation...' : '▶ Simuler'}
        </button>
        {result && (
          <button
            onClick={handleClear}
            className="rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            ✕ Réinitialiser
          </button>
        )}
      </div>

      {/* Erreur */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Résultats — Timeline des étapes */}
      {result && (
        <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-700">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Chemin : {result.initialState} → {result.finalState}
            <span className="ml-2 text-slate-400">({result.steps.length} étape(s))</span>
          </div>

          {result.steps.map((step, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1.5 border text-xs',
                step.reachable
                  ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800'
                  : 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800',
              )}
            >
              <span className={cn('shrink-0 font-bold', step.reachable ? 'text-emerald-600' : 'text-red-500')}>
                {step.reachable ? '✓' : '⛔'}
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  {step.fromState} → {step.action} → {step.toState}
                </div>
                {!step.permGranted && (
                  <div className="text-red-500 text-[10px]">Permission refusée</div>
                )}
                {Object.entries(step.guardResult).map(([g, v]) => (
                  <div key={g} className={cn('text-[10px]', v === false ? 'text-red-500' : v === true ? 'text-emerald-600' : 'text-slate-400')}>
                    {g}: {v === null ? 'indéterminé' : v ? '✓ ok' : '✗ bloqué'}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {result.unreachableStates.length > 0 && (
            <div className="text-[10px] text-slate-400">
              États non atteints : {result.unreachableStates.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
