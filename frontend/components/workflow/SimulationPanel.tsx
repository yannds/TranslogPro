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
import type { WorkflowNode, WorkflowGraph, SimResult, SimOverlay, StructuredStep, StructuredConclusion, HumanSummary } from './types';
import { ReactFlowAdapter } from './ReactFlowAdapter';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useI18n, translate } from '../../lib/i18n/useI18n';
import type { Language } from '../../lib/i18n/types';
import { WORKFLOW_I18N, translateVerb, interpolate, subject } from './workflowI18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Role {
  id:   string;
  name: string;
}

interface SessionSnapshot {
  sessionId:     string;
  entityType:    string;
  actions:       string[];
  cursor:        number;
  breakpoints:   number[];
  status:        'ready' | 'running' | 'paused' | 'completed' | 'blocked';
  steps:         import('./types').SimStep[];
  currentState:  string;
  finalState:    string;
  reachedStates: string[];
  currentEntity: Record<string, unknown>;
  nextAction?:   string;
}

// Guard name → i18n string key mapping
const GUARD_I18N_KEYS: Record<string, string> = {
  checkSoldeAgent:         'simulation.guardCheckSoldeAgent',
  checkTicketNotScanned:   'simulation.guardCheckTicketNotScanned',
  checkParcelNotDelivered: 'simulation.guardCheckParcelNotDelivered',
  checkTripNotDeparted:    'simulation.guardCheckTripNotDeparted',
  checkTripDeparted:       'simulation.guardCheckTripDeparted',
  checkCapacityAvailable:  'simulation.guardCheckCapacityAvailable',
  checkRefundWindow:       'simulation.guardCheckRefundWindow',
  checkClaimDeadline:      'simulation.guardCheckClaimDeadline',
  checkBusOperational:     'simulation.guardCheckBusOperational',
  checkDriverAssigned:     'simulation.guardCheckDriverAssigned',
  checkPaymentConfirmed:   'simulation.guardCheckPaymentConfirmed',
  checkManifestSigned:     'simulation.guardCheckManifestSigned',
  checkWeightLimit:        'simulation.guardCheckWeightLimit',
  checkSenderVerified:     'simulation.guardCheckSenderVerified',
};

// ─── Assemblage des phrases humaines via i18n ─────────────────────────────────

interface RenderedSentence {
  severity: 'success' | 'blocked' | 'info';
  text:     string;
  hint?:    string;
}

/** Construit la headline (bilan global) dans la langue courante. */
function renderHeadline(summary: HumanSummary, lang: Language): string {
  const actor = subject(summary.roleName, summary.ignoredPermissions, lang);
  const n = summary.totalCount;
  const ok = summary.successCount;
  if (n === 0) return translate(WORKFLOW_I18N.headline_empty, lang);
  if (ok === n) {
    return interpolate(translate(WORKFLOW_I18N.headline_all, lang), {
      actor, n, s: n > 1 ? 's' : '',
    });
  }
  if (ok === 0) {
    return interpolate(translate(WORKFLOW_I18N.headline_none, lang), {
      actor, n, s: n > 1 ? 's' : '',
    });
  }
  return interpolate(translate(WORKFLOW_I18N.headline_partial, lang), {
    actor, ok, n, s: n > 1 ? 's' : '', s1: ok > 1 ? 's' : '',
  });
}

/** Rend une étape structurée en phrase localisée. */
function renderStep(step: StructuredStep, summary: HumanSummary, lang: Language): RenderedSentence {
  const actor = subject(summary.roleName, summary.ignoredPermissions, lang);
  const verb  = translateVerb(step.action, lang);

  if (step.reason === 'success') {
    return {
      severity: 'success',
      text: interpolate(translate(WORKFLOW_I18N.tmpl_success, lang), {
        actor, verb, from: step.fromState, to: step.toState,
      }),
    };
  }

  if (step.reason === 'permission_denied') {
    const text = interpolate(translate(WORKFLOW_I18N.tmpl_perm_denied, lang), {
      actor, verb, from: step.fromState,
    });
    const owners = step.rolesWithPermission ?? [];
    const hint = owners.length > 0
      ? interpolate(translate(WORKFLOW_I18N.tmpl_perm_hint_roles, lang), {
          perm: step.missingPermission ?? '', roles: owners.join(', '),
        })
      : interpolate(translate(WORKFLOW_I18N.tmpl_perm_hint_none, lang), {
          perm: step.missingPermission ?? '',
        });
    return { severity: 'blocked', text, hint };
  }

  if (step.reason === 'guard_blocked') {
    return {
      severity: 'blocked',
      text: interpolate(translate(WORKFLOW_I18N.tmpl_guard_blocked, lang), {
        guard: step.guardName ?? '', verb, from: step.fromState,
      }),
      hint: translate(WORKFLOW_I18N.tmpl_guard_hint, lang),
    };
  }

  // transition_unknown
  return {
    severity: 'blocked',
    text: interpolate(translate(WORKFLOW_I18N.tmpl_unknown, lang), {
      verb, from: step.fromState,
    }),
    hint: step.errorMessage,
  };
}

/** Rend la conclusion du résumé (rôles suggérés, permissions manquantes…). */
function renderConclusion(conclusion: StructuredConclusion, lang: Language): RenderedSentence | null {
  switch (conclusion.type) {
    case 'all_success':
      return null;
    case 'try_other_roles':
      return {
        severity: 'info',
        text: interpolate(translate(WORKFLOW_I18N.concl_try_roles, lang), {
          roles: (conclusion.rolesSuggested ?? []).join(', '),
        }),
      };
    case 'no_permission_owner':
      return {
        severity: 'blocked',
        text: interpolate(translate(WORKFLOW_I18N.concl_no_owner, lang), {
          perms: (conclusion.missingPermissions ?? []).join(', '),
        }),
      };
    case 'states_unreachable':
      return {
        severity: 'info',
        text: interpolate(translate(WORKFLOW_I18N.concl_unreachable, lang), {
          states: (conclusion.unreachableStates ?? []).join(', '),
        }),
        hint: translate(WORKFLOW_I18N.concl_unreachable_hint, lang),
      };
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulationPanelProps {
  tenantId:         string;
  entityType:       string;
  nodes:            WorkflowNode[];
  /**
   * Graphe en cours d'édition — envoyé au backend pour simuler CE graphe
   * exactement, pas celui en DB (qui peut différer tant que le designer
   * n'a pas cliqué sur "Sauvegarder").
   */
  currentGraph?:    WorkflowGraph;
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
  currentGraph,
  availableActions,
  availableGuards,
  blueprintId,
  onSimResult,
  onClear,
  className,
}: SimulationPanelProps) {
  const { lang, t } = useI18n();
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

  // ── Modes ──
  // 'auto'       : explore tout depuis l'état initial (par défaut, le plus simple)
  // 'manual'     : enchaîne une séquence d'actions pré-construite
  // 'breakpoint' : pause configurable, contrôles step/continue
  const [mode, setMode] = useState<'auto' | 'manual' | 'breakpoint'>('auto');
  /** Indices d'actions où la session doit s'arrêter (breakpoint après cette étape). */
  const [breakpoints,    setBreakpoints]    = useState<number[]>([]);
  const [sessionId,      setSessionId]      = useState<string | null>(null);
  const [session,        setSession]        = useState<SessionSnapshot | null>(null);

  // Mise à jour de l'état initial si les nœuds changent
  useEffect(() => {
    if (!initialState && initialStates.length > 0) {
      setInitialState(initialStates[0]!.id);
    }
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charger les rôles du tenant pour le sélecteur
  // (contrôleur IAM versionné → /api/…)
  useEffect(() => {
    if (!tenantId) return;
    apiFetch<Role[]>(`/api/tenants/${tenantId}/iam/roles`)
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const toggleBreakpoint = useCallback((index: number) => {
    setBreakpoints(bps =>
      bps.includes(index) ? bps.filter(x => x !== index) : [...bps, index].sort((a, b) => a - b),
    );
  }, []);

  /** Transforme une SessionSnapshot en SimResult pour l'overlay canvas. */
  const sessionAsResult = useCallback((s: SessionSnapshot): SimResult => {
    const nodesSet = new Set((currentGraph?.nodes ?? []).map(n => n.id));
    return {
      entityType:        s.entityType,
      initialState:      initialState,
      finalState:        s.finalState,
      steps:             s.steps,
      reachedStates:     s.reachedStates,
      unreachableStates: Array.from(nodesSet).filter(x => !s.reachedStates.includes(x)),
      finalEntity:       s.currentEntity,
    };
  }, [currentGraph, initialState]);

  const pushSessionToCanvas = useCallback((s: SessionSnapshot) => {
    const simResult = sessionAsResult(s);
    setResult(simResult);
    const overlay = ReactFlowAdapter.buildSimOverlay(simResult);
    onSimResult(simResult, overlay);
  }, [sessionAsResult, onSimResult]);

  // ─── Lancer la simulation (mode normal ou breakpoint) ─────────────────────

  const handleRun = useCallback(async () => {
    // En auto, pas de séquence requise. En manuel/breakpoint il en faut une.
    if (mode !== 'auto' && actionQueue.length === 0) return;
    if (!initialState) return;
    setLoading(true);
    setError(null);
    try {
      const baseBody = {
        entityType,
        initialState,
        simulatedRoleId: roleId || undefined,
        context:         guardContext,
        graph:           currentGraph,
        blueprintId:     blueprintId || undefined,
      };

      if (mode === 'auto') {
        // BFS depuis l'état initial — explore TOUTES les transitions accessibles
        const sim = await apiFetch<SimResult>(
          `/api/tenants/${tenantId}/workflow-studio/simulate/explore`,
          { method: 'POST', body: { ...baseBody, actions: [] } },
        );
        setResult(sim);
        const overlay = ReactFlowAdapter.buildSimOverlay(sim);
        onSimResult(sim, overlay);
      } else if (mode === 'breakpoint') {
        const snap = await apiFetch<SessionSnapshot>(
          `/api/tenants/${tenantId}/workflow-studio/simulate/sessions`,
          { method: 'POST', body: { ...baseBody, actions: actionQueue, breakpoints } },
        );
        setSessionId(snap.sessionId);
        setSession(snap);
        pushSessionToCanvas(snap);
      } else {
        // mode === 'manual'
        const sim = await apiFetch<SimResult>(
          `/api/tenants/${tenantId}/workflow-studio/simulate`,
          { method: 'POST', body: { ...baseBody, actions: actionQueue } },
        );
        setResult(sim);
        const overlay = ReactFlowAdapter.buildSimOverlay(sim);
        onSimResult(sim, overlay);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, entityType, initialState, actionQueue, guardContext, roleId, blueprintId, currentGraph, mode, breakpoints, onSimResult, pushSessionToCanvas]);

  const handleStep = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await apiFetch<SessionSnapshot>(
        `/api/tenants/${tenantId}/workflow-studio/simulate/sessions/${sessionId}/step`,
        { method: 'POST' },
      );
      setSession(snap);
      pushSessionToCanvas(snap);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, sessionId, pushSessionToCanvas]);

  const handleContinue = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const snap = await apiFetch<SessionSnapshot>(
        `/api/tenants/${tenantId}/workflow-studio/simulate/sessions/${sessionId}/continue`,
        { method: 'POST' },
      );
      setSession(snap);
      pushSessionToCanvas(snap);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, sessionId, pushSessionToCanvas]);

  const handleClear = useCallback(async () => {
    if (sessionId) {
      // Fire-and-forget : on libère la session Redis
      apiFetch(
        `/api/tenants/${tenantId}/workflow-studio/simulate/sessions/${sessionId}`,
        { method: 'DELETE' },
      ).catch(() => { /* non bloquant */ });
    }
    setResult(null);
    setError(null);
    setActionQueue([]);
    setGuardContext({});
    setSession(null);
    setSessionId(null);
    setBreakpoints([]);
    onClear();
  }, [tenantId, sessionId, onClear]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col gap-3 text-sm', className)}>

      {/* Titre + badge résultat */}
      <div className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
        <span>{t('simulation.simTitle')}</span>
        {result && (
          <span className={cn(
            'text-xs rounded-full px-2 py-0.5 font-bold',
            result.steps.every(s => s.reachable)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
              : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-200',
          )}>
            {result.steps.every(s => s.reachable) ? t('simulation.success') : t('simulation.blocked')}
          </span>
        )}
      </div>

      {/* ── État initial ── */}
      <div>
        <label className="block text-xs text-slate-500 mb-0.5">{t('simulation.startState')}</label>
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
          {t('simulation.simProfile')}
          <span className="ml-1 text-slate-400">{t('simulation.profileOptional')}</span>
        </label>
        {!rolesLoaded ? (
          <div className="text-xs text-slate-400 italic py-1">{t('simulation.loadingProfiles')}</div>
        ) : roles.length === 0 ? (
          <div className="text-xs text-amber-500 italic py-1">
            {t('simulation.noProfiles')}
          </div>
        ) : (
          <select
            value={roleId}
            onChange={e => setRoleId(e.target.value)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs"
          >
            <option value="">{t('simulation.noProfile')}</option>
            {roles.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── Séquence d'actions à tester (masqué en mode auto) ── */}
      {mode !== 'auto' && (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-slate-500">
            {t('simulation.actionSequence')}
            {actionQueue.length > 0 && (
              <span className="ml-1 text-blue-500">({actionQueue.length})</span>
            )}
          </label>
          {actionQueue.length > 0 && (
            <button
              onClick={clearQueue}
              className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
            >
              {t('simulation.clear')}
            </button>
          )}
        </div>

        {/* File d'actions choisies */}
        {actionQueue.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {actionQueue.map((a, i) => {
              const hasBp  = breakpoints.includes(i + 1); // breakpoint APRÈS l'action i (i+1 dans le cursor)
              const isCurr = session && session.cursor === i + 1 && session.status === 'paused';
              const isDone = session && session.cursor > i;
              return (
                <span
                  key={i}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full text-[10px] font-mono px-2 py-0.5 border',
                    isCurr    ? 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                    : isDone  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 border-transparent',
                  )}
                >
                  <span className="text-slate-400 mr-0.5">{i + 1}.</span>
                  {a}
                  {mode === 'breakpoint' && (
                    <button
                      onClick={() => toggleBreakpoint(i + 1)}
                      className={cn(
                        'ml-0.5 text-[10px] transition-colors',
                        hasBp ? 'text-red-500' : 'text-slate-400 hover:text-red-400',
                      )}
                      title={hasBp ? t('simulation.removeBp') : t('simulation.addBpAfter')}
                      aria-label={hasBp ? `Retirer breakpoint après ${a}` : `Ajouter breakpoint après ${a}`}
                    >
                      ●
                    </button>
                  )}
                  <button
                    onClick={() => removeAction(i)}
                    className="ml-0.5 text-blue-400 hover:text-red-500 transition-colors"
                    aria-label={`Retirer ${a}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
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
                title={`${t('simulation.addActionTitle')} "${a}" ${t('simulation.toSequence')}`}
              >
                + {a}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 italic">
            {t('simulation.noActions')}
          </div>
        )}
      </div>
      )}

      {/* ── Conditions à simuler (guards) ── */}
      {availableGuards.length > 0 && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">
            {t('simulation.testConditions')}
            <span className="ml-1 text-slate-400">{t('simulation.conditionsHint')}</span>
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
                  <span className="text-xs">{GUARD_I18N_KEYS[g] ? t(GUARD_I18N_KEYS[g]) : g}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Sélecteur de mode ── */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">{t('simulation.simMode')}</label>
        <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {([
            { id: 'auto',       labelKey: 'simulation.modeAuto',       hintKey: 'simulation.hintAuto' },
            { id: 'manual',     labelKey: 'simulation.modeManual',     hintKey: 'simulation.hintManual' },
            { id: 'breakpoint', labelKey: 'simulation.modeBreakpoint', hintKey: 'simulation.hintBreakpoint' },
          ] as const).map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (session) return;
                setMode(m.id);
                if (m.id !== 'breakpoint') setBreakpoints([]);
                if (m.id === 'auto') setActionQueue([]);
              }}
              disabled={!!session}
              title={t(m.hintKey)}
              className={cn(
                'flex-1 rounded-md py-1 text-[10px] font-medium transition-colors disabled:opacity-50',
                mode === m.id
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              )}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
        {mode === 'auto' && (
          <p className="text-[9px] text-slate-400 italic mt-1">
            {t('simulation.autoDesc')}
          </p>
        )}
        {mode === 'breakpoint' && (
          <p className="text-[9px] text-amber-500 italic mt-1">
            {t('simulation.bpDesc')}
          </p>
        )}
      </div>

      {/* ── Boutons ── */}
      {!session ? (
        <div className="flex gap-2">
          <button
            onClick={handleRun}
            disabled={loading || !initialState || (mode !== 'auto' && actionQueue.length === 0)}
            className="flex-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 disabled:opacity-50 transition-colors"
          >
            {loading ? t('simulation.simulating')
              : mode === 'breakpoint' ? t('simulation.startSession')
              : mode === 'auto'       ? t('simulation.explore')
              : t('simulation.simulate')}
          </button>
          {(result || actionQueue.length > 0) && (
            <button
              onClick={handleClear}
              className="rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-3 py-1.5 transition-colors"
            >
              {t('simulation.reset')}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className={cn(
            'text-[10px] font-medium rounded-full px-2 py-0.5',
            session.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
            : session.status === 'blocked'   ? 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-200'
            : session.status === 'paused'    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
          )}>
            {session.status} · {t('simulation.step')} {session.cursor}/{session.actions.length}
          </span>

          <button
            onClick={handleStep}
            disabled={loading || session.status === 'completed' || session.status === 'blocked'}
            className="rounded-md bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition-colors"
            title={t('simulation.stepTitle')}
          >
            {t('simulation.stepBtn')}
          </button>
          <button
            onClick={handleContinue}
            disabled={loading || session.status === 'completed' || session.status === 'blocked'}
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50 transition-colors"
            title={t('simulation.continueTitle')}
          >
            ▶▶ Continue
          </button>
          <button
            onClick={handleClear}
            className="rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-3 py-1.5 transition-colors"
          >
            {t('simulation.stop')}
          </button>
        </div>
      )}

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
            <span className="ml-2 text-slate-400">({result.steps.length} {result.steps.length > 1 ? t('simulation.stepPlural') : t('simulation.step')})</span>
          </div>

          {/* ── Interprétation lisible (i18n tenant) ── */}
          {result.humanSummary && (() => {
            const summary      = result.humanSummary;
            const headline     = renderHeadline(summary, lang);
            const stepSentences = summary.perStep.map(s => renderStep(s, summary, lang));
            const conclusion   = summary.conclusion ? renderConclusion(summary.conclusion, lang) : null;

            return (
              <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 p-2 space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <span className="text-sm">💡</span>
                  <p className="text-xs font-medium text-blue-900 dark:text-blue-100 leading-snug">
                    {headline}
                  </p>
                </div>

                {stepSentences.length > 0 && (
                  <ul className="space-y-1 pl-1">
                    {stepSentences.map((s, i) => (
                      <li key={i} className="text-[11px] leading-snug">
                        <div className={cn(
                          s.severity === 'success' ? 'text-emerald-700 dark:text-emerald-300'
                          : s.severity === 'blocked' ? 'text-red-700 dark:text-red-300'
                          : 'text-slate-600 dark:text-slate-300',
                        )}>
                          <span className="font-bold mr-1">
                            {s.severity === 'success' ? '✓' : s.severity === 'blocked' ? '⛔' : 'ℹ'}
                          </span>
                          {s.text}
                        </div>
                        {s.hint && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 italic ml-4 mt-0.5">
                            → {s.hint}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {conclusion && (
                  <div className={cn(
                    'rounded px-2 py-1.5 text-[11px] leading-snug border-l-2',
                    conclusion.severity === 'blocked'
                      ? 'bg-red-50 dark:bg-red-950 border-red-400 text-red-800 dark:text-red-200'
                      : 'bg-amber-50 dark:bg-amber-950 border-amber-400 text-amber-800 dark:text-amber-200',
                  )}>
                    <div className="font-medium">{conclusion.text}</div>
                    {conclusion.hint && (
                      <div className="text-[10px] mt-0.5 italic opacity-80">
                        {conclusion.hint}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Détail technique repliable (pour les utilisateurs avancés) */}
          <details className="text-[10px]">
            <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              {t('simulation.techDetail')}
            </summary>
          </details>

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
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 dark:text-slate-100">
                  {step.fromState} → <span className="text-blue-600 dark:text-blue-400">{step.action}</span> → {step.toState}
                </div>

                {step.permission && (
                  <div className="text-[9px] text-slate-400 font-mono">perm : {step.permission}</div>
                )}

                {!step.permGranted && (
                  <div className="text-red-500 text-[10px]">{t('simulation.permDenied')}</div>
                )}

                {step.errorMessage && !step.permGranted === false && (
                  <div className="text-red-500 text-[10px] mt-0.5 break-words">
                    {step.errorMessage}
                  </div>
                )}

                {Object.entries(step.guardResult).map(([g, v]) => (
                  <div key={g} className={cn('text-[10px]', v === false ? 'text-red-500' : v === true ? 'text-emerald-600' : 'text-slate-400')}>
                    {GUARD_I18N_KEYS[g] ? t(GUARD_I18N_KEYS[g]) : g} : {v === null ? t('simulation.notEvaluated') : v ? t('simulation.guardOk') : t('simulation.guardBlocked')}
                  </div>
                ))}

                {/* Side-effects capturés (jamais exécutés) */}
                {step.capturedSideEffects && step.capturedSideEffects.length > 0 && (
                  <div className="mt-1 pt-1 border-t border-emerald-200 dark:border-emerald-800">
                    <div className="text-[9px] text-slate-400">{t('simulation.wouldTrigger')} :</div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {step.capturedSideEffects.map((se, idx) => (
                        <span
                          key={idx}
                          title={JSON.stringify(se.payload, null, 2)}
                          className="rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[9px] font-mono px-1.5 py-0.5 border border-slate-200 dark:border-slate-700"
                        >
                          {se.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {result.unreachableStates.length > 0 && (
            <div className="text-[10px] text-slate-400">
              {t('simulation.notReached')} : {result.unreachableStates.join(', ')}
            </div>
          )}

          {/* État final de l'entité sandbox */}
          {result.finalEntity && (
            <details className="mt-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
              <summary className="text-[10px] font-medium text-slate-600 dark:text-slate-300 px-2 py-1 cursor-pointer">
                {t('simulation.sandboxEntity')}
              </summary>
              <pre className="text-[9px] font-mono text-slate-600 dark:text-slate-400 px-2 pb-2 overflow-x-auto">
                {JSON.stringify(result.finalEntity, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
