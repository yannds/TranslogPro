/**
 * PageWfSimulate — Simulateur de Workflow Standalone
 *
 * Permet de simuler un chemin de transitions sur n'importe quel workflow
 * configuré pour le tenant, sans avoir besoin d'être dans le Designer.
 *
 * Données :
 *   GET  /api/tenants/:tid/workflow-studio/entity-types → types disponibles
 *   GET  /api/tenants/:tid/workflow-studio/graph/:entityType → graphe
 *   POST /api/tenants/:tid/workflow-studio/simulate → simulation
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  FlaskConical, Play, RotateCcw, CheckCircle2, XCircle,
  ChevronRight, AlertCircle, Loader2, Zap,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../lib/utils';
import type { WorkflowGraph, SimResult } from '../workflow/types';

// ─── Génération automatique de scénarios depuis le graphe ─────────────────────

interface Scenario {
  name:         string;
  description:  string;
  initialState: string;
  actions:      string[];
}

/** Parcours en profondeur pour trouver des chemins de l'état initial vers un terminal */
function buildScenarios(graph: WorkflowGraph | null): Scenario[] {
  if (!graph || graph.nodes.length === 0) return [];

  const initNode     = graph.nodes.find(n => n.type === 'initial');
  const terminalNodes = graph.nodes.filter(n => n.type === 'terminal');
  if (!initNode) return [];

  // Adjacence : fromState → [{ action, toState }]
  const adj: Record<string, { action: string; to: string }[]> = {};
  graph.edges.forEach(e => {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source]!.push({ action: e.label, to: e.target });
  });

  // DFS — limite de profondeur pour éviter les cycles infinis
  const paths: { actions: string[]; finalState: string }[] = [];
  const MAX_DEPTH = 12;

  function dfs(state: string, actions: string[], visited: Set<string>) {
    if (actions.length > MAX_DEPTH) return;
    const isTerminal = terminalNodes.some(t => t.id === state);
    if (isTerminal && actions.length > 0) {
      paths.push({ actions: [...actions], finalState: state });
      if (paths.length >= 6) return; // Limiter à 6 scénarios
      return;
    }
    const next = adj[state] ?? [];
    for (const { action, to } of next) {
      if (visited.has(to)) continue; // éviter cycles
      visited.add(to);
      dfs(to, [...actions, action], new Set(visited));
      if (paths.length >= 6) return;
    }
  }

  const startVisited = new Set([initNode.id]);
  dfs(initNode.id, [], startVisited);

  // Ajouter aussi des scénarios partiels pertinents (ex: happy path + blocages)
  const scenarios: Scenario[] = paths.map((p, i) => ({
    name:         i === 0 ? 'Chemin nominal' : `Chemin ${i + 1}`,
    description:  `${initNode.id} → ${p.finalState} (${p.actions.length} étape${p.actions.length > 1 ? 's' : ''})`,
    initialState: initNode.id,
    actions:      p.actions,
  }));

  // Ajouter un scénario "partiel" avec juste les 2 premières actions
  if (paths[0] && paths[0].actions.length > 2) {
    scenarios.push({
      name:         'Test partiel',
      description:  `Valider les 2 premières transitions`,
      initialState: initNode.id,
      actions:      paths[0].actions.slice(0, 2),
    });
  }

  return scenarios;
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWfSimulate() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/workflow-studio`;

  // ── Step 1 : sélection entité ──
  const { data: entityTypes, loading: loadingTypes, error: typesError } = useFetch<string[]>(
    tenantId ? `${base}/entity-types` : null,
    [tenantId],
  );

  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [graph,          setGraph]          = useState<WorkflowGraph | null>(null);
  const [loadingGraph,   setLoadingGraph]   = useState(false);
  const [graphError,     setGraphError]     = useState<string | null>(null);

  // ── Step 2 : config simulation ──
  const [initialState, setInitialState] = useState('');
  const [actionsText,  setActionsText]  = useState('');
  const [contextText,  setContextText]  = useState('{}');
  const [roleId,       setRoleId]       = useState('');

  const scenarios = useMemo(() => buildScenarios(graph), [graph]);

  // ── Step 3 : résultats ──
  const [result,      setResult]      = useState<SimResult | null>(null);
  const [simLoading,  setSimLoading]  = useState(false);
  const [simError,    setSimError]    = useState<string | null>(null);

  // Charger le graphe quand l'entité change
  useEffect(() => {
    if (!selectedEntity || !tenantId) return;
    setGraph(null);
    setGraphError(null);
    setResult(null);
    setInitialState('');
    setLoadingGraph(true);

    apiFetch<WorkflowGraph>(`${base}/graph/${selectedEntity}`)
      .then(g => {
        setGraph(g);
        const initNode = g.nodes.find(n => n.type === 'initial');
        if (initNode) setInitialState(initNode.id);
      })
      .catch(e => setGraphError((e as Error).message))
      .finally(() => setLoadingGraph(false));
  }, [selectedEntity, tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSimulate = useCallback(async () => {
    if (!selectedEntity || !initialState || !actionsText.trim()) return;
    setSimLoading(true);
    setSimError(null);
    setResult(null);

    try {
      const actions = actionsText.split(',').map(a => a.trim()).filter(Boolean);
      let ctx: Record<string, unknown> = {};
      try { ctx = JSON.parse(contextText); } catch { /* keep empty */ }

      const sim = await apiFetch<SimResult>(`${base}/simulate`, {
        method: 'POST',
        body: {
          entityType:   selectedEntity,
          initialState,
          actions,
          context:      ctx,
          simulatedRoleId: roleId || undefined,
        },
      });
      setResult(sim);
    } catch (e) {
      setSimError((e as Error).message);
    } finally {
      setSimLoading(false);
    }
  }, [selectedEntity, initialState, actionsText, contextText, roleId, base]);

  const handleReset = () => {
    setResult(null);
    setSimError(null);
    setActionsText('');
    setContextText('{}');
    setRoleId('');
  };

  const inputClass = cn(
    'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
    'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400',
    'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50',
  );

  const allSuccess = result?.steps.every(s => s.reachable);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">

      {/* En-tête */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
          <FlaskConical className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Simulateur</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Testez des chemins de transitions sans modifier les données
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Panneau gauche : configuration ── */}
        <div className="space-y-4">

          {/* Step 1 : Sélection entité */}
          <Card>
            <CardHeader heading="1. Type d'entité" />
            <CardContent className="pt-3 space-y-3">
              {loadingTypes ? (
                <Skeleton className="h-10 w-full" />
              ) : typesError ? (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" aria-hidden /> {typesError}
                </div>
              ) : !entityTypes || entityTypes.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Aucun workflow configuré. Installez un Blueprint d'abord.
                </p>
              ) : (
                <select
                  value={selectedEntity ?? ''}
                  onChange={e => setSelectedEntity(e.target.value || null)}
                  className={inputClass}
                >
                  <option value="">— Sélectionnez un type —</option>
                  {entityTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}

              {loadingGraph && (
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  Chargement du graphe…
                </div>
              )}
              {graphError && (
                <div role="alert" className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" aria-hidden /> {graphError}
                </div>
              )}
              {graph && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  ✓ Graphe chargé — {graph.nodes.length} états · {graph.edges.length} transitions
                </p>
              )}
            </CardContent>
          </Card>

          {/* Step 2 : Configuration simulation */}
          <Card>
            <CardHeader heading="2. Configuration" />
            <CardContent className="pt-3 space-y-3">
              {/* État initial */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  État initial <span aria-hidden className="text-red-500">*</span>
                </label>
                {graph ? (
                  <select
                    value={initialState}
                    onChange={e => setInitialState(e.target.value)}
                    className={inputClass}
                    disabled={!graph || simLoading}
                  >
                    {graph.nodes.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.label} ({n.id})
                        {n.type === 'initial' ? ' — initial' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={initialState}
                    onChange={e => setInitialState(e.target.value)}
                    placeholder="Sélectionnez un type d'entité d'abord"
                    className={inputClass}
                    disabled
                  />
                )}
              </div>

              {/* Séquence d'actions */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Actions à simuler <span aria-hidden className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={actionsText}
                  onChange={e => setActionsText(e.target.value)}
                  placeholder="sell,validate,board,complete"
                  className={`${inputClass} font-mono`}
                  disabled={!graph || simLoading}
                />
                <p className="text-xs text-slate-400">Actions séparées par des virgules</p>
                {/* Actions disponibles */}
                {graph && (
                  <div className="mt-1">
                    <p className="text-[10px] text-slate-400 mb-1">Actions disponibles :</p>
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(graph.edges.map(e => e.label))].map(action => (
                        <button
                          key={action}
                          type="button"
                          onClick={() => setActionsText(p => p ? `${p},${action}` : action)}
                          className="rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-0.5 text-[10px] font-mono text-slate-600 dark:text-slate-400 transition-colors"
                        >
                          + {action}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Scénarios auto-générés */}
              {scenarios.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" aria-hidden />
                    Scénarios
                  </p>
                  <div className="space-y-1">
                    {scenarios.map((sc, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setInitialState(sc.initialState);
                          setActionsText(sc.actions.join(','));
                        }}
                        className="w-full flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-3 py-2 text-left transition-colors group"
                        disabled={simLoading}
                      >
                        <span className="shrink-0 w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40 flex items-center justify-center text-[10px] font-bold text-slate-500 dark:text-slate-400 transition-colors">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{sc.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{sc.description}</p>
                          <p className="text-[10px] font-mono text-blue-600 dark:text-blue-400 truncate mt-0.5">
                            {sc.actions.join(' → ')}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Contexte guards */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Contexte guards (JSON)
                </label>
                <textarea
                  value={contextText}
                  onChange={e => setContextText(e.target.value)}
                  rows={3}
                  placeholder='{"checkBalance":true,"amount":50000}'
                  className={`${inputClass} font-mono text-xs resize-none`}
                  disabled={!graph || simLoading}
                />
              </div>

              {/* Role simulé */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Role ID simulé (optionnel)
                </label>
                <input
                  type="text"
                  value={roleId}
                  onChange={e => setRoleId(e.target.value)}
                  placeholder="UUID du rôle à simuler…"
                  className={`${inputClass} font-mono`}
                  disabled={!graph || simLoading}
                />
              </div>
            </CardContent>
          </Card>

          {/* Boutons */}
          <div className="flex gap-3">
            <Button
              onClick={handleSimulate}
              disabled={!graph || !initialState || !actionsText.trim() || simLoading}
              className="flex-1"
            >
              {simLoading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />Simulation…</>
              ) : (
                <><Play className="w-4 h-4 mr-2" aria-hidden />Lancer la simulation</>
              )}
            </Button>
            {(result || simError) && (
              <Button variant="outline" onClick={handleReset} disabled={simLoading}>
                <RotateCcw className="w-4 h-4 mr-2" aria-hidden />
                Réinitialiser
              </Button>
            )}
          </div>
        </div>

        {/* ── Panneau droit : résultats ── */}
        <div className="space-y-4">
          <Card className="h-full">
            <CardHeader heading="3. Résultats" />
            <CardContent className="pt-3">

              {!result && !simError && !simLoading && (
                <div className="py-12 text-center text-slate-400 dark:text-slate-600">
                  <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden />
                  <p className="text-sm">Configurez une simulation et cliquez sur "Lancer"</p>
                </div>
              )}

              {simLoading && (
                <div className="py-12 flex items-center justify-center gap-3 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin" aria-hidden />
                  <span>Simulation en cours…</span>
                </div>
              )}

              {simError && (
                <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden />
                  {simError}
                </div>
              )}

              {result && (
                <div className="space-y-4" role="region" aria-label="Résultats de simulation">

                  {/* Résumé */}
                  <div className={cn(
                    'rounded-lg border px-4 py-3 flex items-center gap-3',
                    allSuccess
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800',
                  )}>
                    {allSuccess
                      ? <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
                      : <XCircle     className="w-5 h-5 text-red-600    dark:text-red-400    shrink-0" aria-hidden />
                    }
                    <div>
                      <p className={cn('font-semibold text-sm',
                        allSuccess ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200',
                      )}>
                        {allSuccess ? 'Simulation réussie' : 'Simulation bloquée'}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        {result.initialState}
                        <ChevronRight className="w-3 h-3 inline mx-0.5" aria-hidden />
                        {result.finalState}
                        <span className="ml-2 text-slate-400">({result.steps.length} étape{result.steps.length > 1 ? 's' : ''})</span>
                      </p>
                    </div>
                  </div>

                  {/* Timeline des étapes */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                      Détail des transitions
                    </p>
                    {result.steps.map((step, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs',
                          step.reachable
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                            : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
                        )}
                      >
                        <span className={cn(
                          'shrink-0 font-bold text-base leading-none mt-0.5',
                          step.reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500',
                        )}>
                          {step.reachable ? '✓' : '✗'}
                        </span>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{step.fromState}</span>
                            <ChevronRight className="w-3 h-3 text-slate-400" aria-hidden />
                            <span className="font-mono text-blue-600 dark:text-blue-400">{step.action}</span>
                            <ChevronRight className="w-3 h-3 text-slate-400" aria-hidden />
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{step.toState}</span>
                          </div>
                          {!step.permGranted && (
                            <p className="text-red-500 text-[10px] flex items-center gap-1">
                              <XCircle className="w-3 h-3" aria-hidden />
                              Permission insuffisante
                            </p>
                          )}
                          {Object.entries(step.guardResult).map(([g, v]) => (
                            <p key={g} className={cn(
                              'text-[10px] flex items-center gap-1',
                              v === false ? 'text-red-500' : v === true ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400',
                            )}>
                              <span>{v === null ? '?' : v ? '✓' : '✗'}</span>
                              <span className="font-mono">{g}</span>
                              <span className="text-slate-400">: {v === null ? 'indéterminé' : v ? 'ok' : 'bloqué'}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* États atteints / non atteints */}
                  {result.reachedStates.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">États atteints</p>
                      <div className="flex flex-wrap gap-1">
                        {result.reachedStates.map(s => (
                          <span key={s} className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.unreachableStates.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-slate-400">États non atteints</p>
                      <div className="flex flex-wrap gap-1">
                        {result.unreachableStates.map(s => (
                          <span key={s} className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-500 dark:text-slate-400">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
