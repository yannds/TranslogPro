/**
 * WorkflowDesigner — Éditeur visuel de workflow (React Flow)
 *
 * Fonctionnalités :
 *   - Canvas React Flow avec nœuds StateNode + arêtes TransitionEdge
 *   - Panneau propriétés (clic sur nœud/arête → édition inline)
 *   - Simulation Live-Path (overlay vert/rouge)
 *   - Marketplace / Import / Export (BlueprintPanel)
 *   - Boutons : Sauvegarder | Réinitialiser | Valider
 *   - Toggle sidebar : Simulation | Blueprints
 *
 * Dépendances : reactflow, ../ReactFlowAdapter, ./nodes/StateNode, ./edges/TransitionEdge
 *
 * Usage :
 *   <WorkflowDesigner tenantId="..." entityType="Ticket" />
 */
import {
  useState, useCallback, useEffect, useMemo,
} from 'react';
import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  addEdge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type Node,
  type Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StateNode }       from './nodes/StateNode';
import { TransitionEdge }  from './edges/TransitionEdge';
import { SimulationPanel } from './SimulationPanel';
import { BlueprintPanel }  from './BlueprintPanel';
import { ReactFlowAdapter, type RFNode, type RFEdge, type RFNodeData, type RFEdgeData } from './ReactFlowAdapter';
import type { WorkflowGraph, SimResult, SimOverlay } from './types';
import { apiFetch } from '../../lib/api';
import { cn } from '../../lib/utils';

// ─── Node / Edge types (mémoïsés hors du composant pour éviter les re-render) ─

const NODE_TYPES = { workflowState: StateNode } as const;
const EDGE_TYPES = { workflowTransition: TransitionEdge } as const;

// ─── Propriétés du panneau d'édition ──────────────────────────────────────────

interface NodeEditPanel {
  type: 'node';
  id:   string;
  data: RFNodeData;
}
interface EdgeEditPanel {
  type: 'edge';
  id:   string;
  data: RFEdgeData;
}
type EditPanel = NodeEditPanel | EdgeEditPanel | null;

// ─── Types sidebar ─────────────────────────────────────────────────────────────

type SidePanel = 'simulation' | 'blueprints' | null;

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkflowDesignerProps {
  tenantId:   string;
  entityType: string;
  /** Graphe initial (pré-chargé depuis l'API) */
  initialGraph?: WorkflowGraph;
  /** Appelé après sauvegarde réussie */
  onSaved?:   (graph: WorkflowGraph) => void;
}

// ─── Composant principal ───────────────────────────────────────────────────────

export function WorkflowDesigner({
  tenantId,
  entityType,
  initialGraph,
  onSaved,
}: WorkflowDesignerProps) {
  const [graph,        setGraph]        = useState<WorkflowGraph | null>(initialGraph ?? null);
  const [nodes,        setNodes,  onNodesChange]  = useNodesState<RFNodeData>([]);
  const [edges,        setEdges,  onEdgesChange]  = useEdgesState<RFEdgeData>([]);
  const [_simOverlay,  setSimOverlay]   = useState<SimOverlay>({});
  const [editPanel,    setEditPanel]    = useState<EditPanel>(null);
  const [sidePanel,    setSidePanel]    = useState<SidePanel>('simulation');
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState<string | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(!initialGraph);
  const [error,        setError]        = useState<string | null>(null);
  const [isDirty,      setIsDirty]      = useState(false);

  // ─── Charger graphe depuis l'API ──────────────────────────────────────────

  useEffect(() => {
    if (initialGraph) {
      syncGraphToRF(initialGraph);
      setGraph(initialGraph);
      setLoadingGraph(false);
      return;
    }
    setLoadingGraph(true);
    apiFetch<WorkflowGraph>(`/api/tenants/${tenantId}/workflow-studio/graph/${entityType}`)
      .then(g => {
        setGraph(g);
        syncGraphToRF(g);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoadingGraph(false));
  }, [tenantId, entityType]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncGraphToRF = useCallback((g: WorkflowGraph) => {
    const { nodes: rfn, edges: rfe } = ReactFlowAdapter.toReactFlow(g, {});
    setNodes(rfn as any);
    setEdges(rfe as any);
  }, [setNodes, setEdges]);

  // ─── Marquer dirty à chaque changement ───────────────────────────────────

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
    if (changes.some(c => c.type === 'position' || c.type === 'remove')) setIsDirty(true);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChange(changes);
    setIsDirty(true);
  }, [onEdgesChange]);

  const handleConnect = useCallback((connection: Connection) => {
    setEdges((eds: Edge<RFEdgeData>[]) => addEdge({
      ...connection,
      type: 'workflowTransition',
      data: { action: 'NOUVELLE_ACTION', guards: [], permission: '', sideEffects: [] },
    }, eds));
    setIsDirty(true);
  }, [setEdges]);

  // ─── Simulation overlay ───────────────────────────────────────────────────

  const handleSimResult = useCallback((_result: SimResult, overlay: SimOverlay) => {
    setSimOverlay(overlay);
    if (!graph) return;
    const { nodes: rfn, edges: rfe } = ReactFlowAdapter.toReactFlow(graph, overlay);
    setNodes(rfn as any);
    setEdges(rfe as any);
  }, [graph, setNodes, setEdges]);

  const handleSimClear = useCallback(() => {
    setSimOverlay({});
    if (graph) syncGraphToRF(graph);
  }, [graph, syncGraphToRF]);

  // ─── Sauvegarder ────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const updatedGraph = ReactFlowAdapter.fromReactFlow(
        nodes as RFNode[], edges as RFEdge[], entityType,
      );
      const saved = await apiFetch<WorkflowGraph>(
        `/api/tenants/${tenantId}/workflow-studio/graph`,
        { method: 'PUT', body: updatedGraph },
      );

      setGraph(saved);
      syncGraphToRF(saved);
      setIsDirty(false);
      setSaveMsg('Graphe sauvegardé avec succès');
      onSaved?.(saved);
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [tenantId, entityType, nodes, edges, syncGraphToRF, onSaved]);

  // ─── Installer un blueprint ───────────────────────────────────────────────

  const handleInstall = useCallback(async (blueprintId: string) => {
    const installed = await apiFetch<WorkflowGraph>(
      `/api/tenants/${tenantId}/workflow-studio/blueprints/${blueprintId}/install`,
      { method: 'POST' },
    );
    setGraph(installed);
    syncGraphToRF(installed);
    setIsDirty(false);
    setSaveMsg(`Blueprint installé — graphe rechargé`);
    setTimeout(() => setSaveMsg(null), 3000);
  }, [tenantId, syncGraphToRF]);

  // ─── Panneau propriétés (clic nœud/arête) ────────────────────────────────

  const handleNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    setEditPanel({ type: 'node', id: node.id, data: { ...node.data } });
  }, []);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: RFEdge) => {
    setEditPanel({ type: 'edge', id: edge.id, data: { ...edge.data } });
  }, []);

  const handlePaneClick = useCallback(() => setEditPanel(null), []);

  // ─── Ajouter un nouvel état (nœud) au canvas ─────────────────────────────

  const handleAddState = useCallback(() => {
    const id    = `STATE_${Date.now()}`;
    // Positionne le nouveau nœud décalé du dernier pour éviter les superpositions
    const lastY = nodes.length > 0
      ? Math.max(...nodes.map((n: Node<RFNodeData>) => (n.position?.y ?? 0))) + 140
      : 80;
    const newNode: Node<RFNodeData> = {
      id,
      type: 'workflowState',
      position: { x: 200, y: lastY },
      data: {
        label:           id,
        stateType:       'state',
        transitionCount: 0,
      },
    };
    setNodes((ns: Node<RFNodeData>[]) => [...ns, newNode]);
    setEditPanel({ type: 'node', id, data: { ...newNode.data } });
    setIsDirty(true);
  }, [nodes, setNodes]);

  // Applique les éditions du panneau propriétés dans les nodes/edges RF
  const applyNodeEdit = useCallback((data: RFNodeData) => {
    if (!editPanel || editPanel.type !== 'node') return;
    setNodes((ns: Node<RFNodeData>[]) => ns.map((n: Node<RFNodeData>) => n.id === editPanel.id ? { ...n, data } : n));
    setIsDirty(true);
  }, [editPanel, setNodes]);

  const applyEdgeEdit = useCallback((data: RFEdgeData) => {
    if (!editPanel || editPanel.type !== 'edge') return;
    setEdges((es: Edge<RFEdgeData>[]) => es.map((e: Edge<RFEdgeData>) => e.id === editPanel.id ? { ...e, data, label: data.action } : e));
    setIsDirty(true);
  }, [editPanel, setEdges]);

  // ─── Graph dérivé (pour SimulationPanel) ─────────────────────────────────

  const liveGraph = useMemo<WorkflowGraph | undefined>(() => {
    if (!graph) return undefined;
    return ReactFlowAdapter.fromReactFlow(
      nodes as RFNode[], edges as RFEdge[], entityType,
    );
  }, [graph, nodes, edges, entityType]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loadingGraph) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400 text-sm">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 mr-2" />
        Chargement du graphe…
      </div>
    );
  }

  return (
    <div className="flex h-full gap-0 bg-slate-50 dark:bg-slate-950">

      {/* ── Canvas React Flow ────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50 shadow transition-colors"
          >
            {saving ? 'Sauvegarde…' : isDirty ? '● Sauvegarder' : '✓ Sauvegardé'}
          </button>

          <button
            onClick={handleAddState}
            className="rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium px-3 py-1.5 shadow transition-colors"
            title="Ajouter un nouvel état au canvas"
          >
            + État
          </button>

          <button
            onClick={() => graph && syncGraphToRF(graph)}
            disabled={!isDirty}
            className="rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium px-3 py-1.5 disabled:opacity-50 shadow transition-colors"
          >
            ↺ Annuler
          </button>

          <button
            onClick={() => setSidePanel(p => p === 'simulation' ? null : 'simulation')}
            className={cn(
              'rounded-md border text-xs font-medium px-3 py-1.5 shadow transition-colors',
              sidePanel === 'simulation'
                ? 'bg-emerald-600 border-emerald-600 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
            )}
          >
            ▶ Simulation
          </button>

          <button
            onClick={() => setSidePanel(p => p === 'blueprints' ? null : 'blueprints')}
            className={cn(
              'rounded-md border text-xs font-medium px-3 py-1.5 shadow transition-colors',
              sidePanel === 'blueprints'
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300',
            )}
          >
            📋 Blueprints
          </button>

          {saveMsg && (
            <span className="rounded-md bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-200 text-xs px-2 py-1.5">
              {saveMsg}
            </span>
          )}
          {error && (
            <span className="rounded-md bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300 text-xs px-2 py-1.5 max-w-xs truncate">
              ⚠ {error}
            </span>
          )}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={handleNodeClick as any}
          onEdgeClick={handleEdgeClick as any}
          onPaneClick={handlePaneClick}
          fitView
          className="bg-slate-50 dark:bg-slate-950"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e2e8f0" gap={20} size={1} />
          <Controls className="!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700" />
          <MiniMap
            nodeColor={(n: Node<RFNodeData>) => {
              const st = n.data?.stateType;
              return st === 'initial' ? '#3b82f6' : st === 'terminal' ? '#64748b' : '#94a3b8';
            }}
            maskColor="rgba(241,245,249,0.7)"
          />
        </ReactFlow>

        {/* Panneau propriétés (flottant bas-droite du canvas) */}
        {editPanel && (
          <div className="absolute bottom-4 right-4 z-20 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-4 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {editPanel.type === 'node' ? '◉ État' : '→ Transition'}
              </span>
              <button onClick={() => setEditPanel(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {editPanel.type === 'node' && (
              <NodePropsEditor data={editPanel.data} onChange={applyNodeEdit} />
            )}
            {editPanel.type === 'edge' && (
              <EdgePropsEditor data={editPanel.data} onChange={applyEdgeEdit} />
            )}
          </div>
        )}
      </div>

      {/* ── Side panel ───────────────────────────────────────────── */}
      {sidePanel && (
        <div className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto p-4">
          {sidePanel === 'simulation' && (
            <SimulationPanel
              tenantId={tenantId}
              entityType={entityType}
              nodes={liveGraph?.nodes ?? []}
              onSimResult={handleSimResult}
              onClear={handleSimClear}
            />
          )}
          {sidePanel === 'blueprints' && (
            <BlueprintPanel
              tenantId={tenantId}
              currentGraph={liveGraph}
              onInstall={handleInstall}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── NodePropsEditor ─────────────────────────────────────────────────────────

function NodePropsEditor({ data, onChange }: { data: RFNodeData; onChange: (d: RFNodeData) => void }) {
  return (
    <div className="space-y-2">
      <Field label="Label" value={data.label} onChange={v => onChange({ ...data, label: v })} />
      <div>
        <label className="block text-[10px] text-slate-500 mb-0.5">Type</label>
        <select
          value={data.stateType}
          onChange={e => onChange({ ...data, stateType: e.target.value as RFNodeData['stateType'] })}
          className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs"
        >
          <option value="initial">initial</option>
          <option value="state">state</option>
          <option value="terminal">terminal</option>
        </select>
      </div>
    </div>
  );
}

// ─── EdgePropsEditor ─────────────────────────────────────────────────────────

function EdgePropsEditor({ data, onChange }: { data: RFEdgeData; onChange: (d: RFEdgeData) => void }) {
  return (
    <div className="space-y-2">
      <Field label="Action" value={data.action} onChange={v => onChange({ ...data, action: v })} mono />
      <Field label="Permission" value={data.permission} onChange={v => onChange({ ...data, permission: v })} mono />
      <Field
        label="Guards (virgule)"
        value={data.guards?.join(', ') ?? ''}
        onChange={v => onChange({ ...data, guards: v.split(',').map(s => s.trim()).filter(Boolean) })}
      />
      <Field
        label="SideEffects (virgule)"
        value={data.sideEffects?.join(', ') ?? ''}
        onChange={v => onChange({ ...data, sideEffects: v.split(',').map(s => s.trim()).filter(Boolean) })}
      />
    </div>
  );
}

function Field({
  label, value, onChange, mono,
}: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-0.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs',
          mono && 'font-mono',
        )}
      />
    </div>
  );
}
