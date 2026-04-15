/**
 * SimulationPanel — Panneau Live-Path
 *
 * Permet de simuler un chemin de transitions sans toucher à la DB.
 * Interface non-technique : pas de JSON, pas d'UUID à saisir.
 *
 * Usage :
 *   <SimulationPanel
 *     tenantId="..."
 *     entityType="Ticket"
 *     nodes={graph.nodes}
 *     availableActions={["confirm","cancel",...]}
 *     availableGuards={["checkSoldeAgent",...]}
 *     onSimResult={(result, overlay) => ...}
 *     onClear={() => ...}
 *   />
 */
import { useState, useCallback, useEffect } from 'react';
import type { WorkflowNode, SimResult, SimOverlay } from './types';
import { ReactFlowAdapter } from './ReactFlowAdapter';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Role {
  id:   string;
  name: string;
}

// Labels humains pour les guards connus
const GUARD_LABELS: Record<string, string> = {
  checkSoldeAgent:         'Solde agent suffisant',
  checkTicketNotScanned:   'Ticket non encore scanné',
  checkParcelNotDelivered: 'Colis non encore livré',
  checkTripNotDeparted:    'Trajet non encore parti',
  checkTripDeparted:       'Trajet déjà parti',
  checkCapacityAvailable:  'Places disponibles',
  checkRefundWindow:       'Dans la fenêtre de remboursement',
  checkClaimDeadline:      'Délai réclamation non dépassé',
  checkBusOperational:     'Bus opérationnel',
  checkDriverAssigned:     'Chauffeur affecté',
  checkPaymentConfirmed:   'Paiement confirmé',
  checkManifestSigned:     'Manifeste signé',
  checkWeightLimit:        'Poids limite respecté',
  checkSenderVerified:     'Expéditeur vérifié',
};

function guardLabel(name: string): string {
  return GUARD_LABELS[name] ?? name;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulationPanelProps {
  tenantId:         string;
  entityType:       string;
  nodes:            WorkflowNode[];
  availableActions: string[];
  availableGuards:  string[];
  blueprintId?:     string;
  onSimResult:      (result: SimResult, overlay: SimOverlay) => void;
  onClear:          () => void;
  className?:       string;
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function SimulationPanel({
  tenantId,
  entityType,
  nodes,
  availableActions,
  availableGuards,
  blueprintId,
  onSimResult,
  onClear,
  className,
}: SimulationPanelProps) {
  const initialStates = nodes.filter(n => n.type === 'initial');

  const [initialState, setInitialState]   = useState(initialStates[0]?.id ?? '');
  const [actionQueue,  setActionQueue]    = useState<string[]>([]);
  const [guardContext, setGuardContext]   = useState<Record<string, boolean>>({});
  const [roleId,       setRoleId]         = useState('');
  const [roles,        setRoles]          = useState<Role[]>([]);
  const [rolesLoaded,  setRolesLoaded]    = useState(false);
  const [result,       setResult]         = useState<SimResult | null>(null);
  const [loading,      setLoading]        = useState(false);
  const [error,        setError]          = useState<string | null>(null);

  // Mise à jour de l'état initial si les nœuds changent
  useEffect(() => {
    if (!initialState && initialStates.length > 0) {
      setInitialState(initialStates[0]!.id);
    }
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charger les rôles du tenant pour le sélecteur
  // (contrôleur IAM versionné → /api/v1/…)
  useEffect(() => {
    if (!tenantId) return;
    apiFetch<Role[]>(`/api/v1/tenants/${tenantId}/iam/roles`)
      .then(setRoles)
      .catch(() => setRoles([]))
      .finally(() => setRolesLoaded(true));
  }, [tenantId]);

  // ─── Handlers actions ──────────────────────────────────────────────────────

  const addAction = useCallback((action: string) => {
    setActionQueue(q => [...q, action]);
  }, []);

  const removeAction = useCallback((index: number) => {
    setActionQueue(q => q.filter((_, i) => i !== index));
  }, []);

  const clearQueue = useCallback(() => setActionQueue([]), []);

  // ─── Lancer la simulation ──────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (actionQueue.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const sim = await apiFetch<SimResult>(
        `/api/tenants/${tenantId}/workflow-studio/simulate`,
        {
          method: 'POST',
          body: {
            entityType,
            initialState,
            actions:         actionQueue,
            simulatedRoleId: roleId || undefined,
            context:         guardContext,
            blueprintId:     blueprintId || undefined,
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
  }, [tenantId, entityType, initialState, actionQueue, guardContext, roleId, blueprintId, onSimResult]);

  const handleClear = useCallback(() => {
    setResult(null);
    setError(null);
    setActionQueue([]);
    setGuardContext({});
    onClear();
  }, [onClear]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)}>

      {/* Titre + badge résultat */}
      <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
        <span>▶ Simulation Live-Path</span>
        {result && (
          <span className={cn(
            'text-xs rounded-full px-2 py-0.5 font-bold',
            result.steps.every(s => s.reachable)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
              : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-200',
          )}>
            {result.steps.every(s => s.reachable) ? '✓ Succès' : '⛔ Bloqué'}
          </span>
        )}
      </div>

      {/* ── État initial ── */}
      <div>
        <label className="block text-xs text-slate-500 mb-0.5">État de départ</label>
        <select
          value={initialState}
          onChange={e => setInitialState(e.target.value)}
          className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
        >
          {nodes.map(n => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>
      </div>

      {/* ── Profil simulé ── */}
      <div>
        <label className="block text-xs text-slate-500 mb-0.5">
          Profil simulé
          <span className="ml-1 text-slate-400">(optionnel — teste les permissions)</span>
        </label>
        {!rolesLoaded ? (
          <div className="text-xs text-slate-400 italic py-1">Chargement des profils…</div>
        ) : roles.length === 0 ? (
          <div className="text-xs text-amber-500 italic py-1">
            Aucun profil IAM disponible — la simulation ignorera les permissions.
          </div>
        ) : (
          <select
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
          >
            <option value="">— Aucun (permissions ignorées) —</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Séquence d'actions à tester ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-slate-500">
            Séquence d'actions
            {actionQueue.length > 0 && (
              <span className="ml-1 text-blue-500">({actionQueue.length})</span>
            )}
          </label>
          {actionQueue.length > 0 && (
            <button
              onClick={clearQueue}
              className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
            >
              ✕ Vider
            </button>
          )}
        </div>

        {/* File d'actions choisies */}
        {actionQueue.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {actionQueue.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 text-[10px] font-mono px-2 py-0.5"
              >
                <span className="text-slate-400 mr-0.5">{i + 1}.</span>
                {a}
                <button
                  onClick={() => removeAction(i)}
                  className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors"
                  aria-label={`Retirer ${a}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Actions disponibles (cliquables) */}
        {availableActions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {availableActions.map(a => (
              <button
                key={a}
                onClick={() => addAction(a)}
                className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-600 dark:hover:text-blue-300 text-[10px] font-mono px-2 py-0.5 transition-colors"
                title={`Ajouter l'action "${a}" à la séquence`}
              >
                + {a}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 italic">
            Aucune action disponible — chargez d'abord un graphe.
          </div>
        )}
      </div>

      {/* ── Conditions à simuler (guards) ── */}
      {availableGuards.length > 0 && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">
            Conditions de test
            <span className="ml-1 text-slate-400">(activez celles qui s'appliquent)</span>
          </label>
          <div className="space-y-1">
            {availableGuards.map(g => {
              const checked = guardContext[g] === true;
              return (
                <label
                  key={g}
                  className={cn(
                    'flex items-center gap-2 cursor-pointer rounded-md px-2 py-1 border transition-colors',
                    checked
                      ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      setGuardContext(ctx => {
                        const next = { ...ctx };
                        if (e.target.checked) next[g] = true;
                        else delete next[g];
                        return next;
                      });
                    }}
                    className="accent-emerald-600"
                  />
                  <span className="text-xs">{guardLabel(g)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Boutons ── */}
      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={loading || !initialState || actionQueue.length === 0}
          className="flex-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Simulation…' : '▶ Simuler'}
        </button>
        {(result || actionQueue.length > 0) && (
          <button
            onClick={handleClear}
            className="rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            ✕ Réinitialiser
          </button>
        )}
      </div>

      {/* ── Erreur ── */}
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Résultats ── */}
      {result && (
        <div className="space-y-1.5 pt-1 border-t border-slate-200 dark:border-slate-700">
          <div className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {result.initialState} → {result.finalState}
            <span className="ml-2 text-slate-400">({result.steps.length} étape{result.steps.length > 1 ? 's' : ''})</span>
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
                  {step.fromState} → <span className="text-blue-600 dark:text-blue-400">{step.action}</span> → {step.toState}
                </div>
                {!step.permGranted && (
                  <div className="text-red-500 text-[10px]">Permission refusée pour ce profil</div>
                )}
                {Object.entries(step.guardResult).map(([g, v]) => (
                  <div key={g} className={cn('text-[10px]', v === false ? 'text-red-500' : v === true ? 'text-emerald-600' : 'text-slate-400')}>
                    {guardLabel(g)} : {v === null ? 'non évalué' : v ? '✓ ok' : '✗ bloqué'}
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
