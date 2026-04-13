/**
 * ReactFlowAdapter
 *
 * Convertit WorkflowGraph (UI-agnostique) ←→ React Flow {nodes[], edges[]}.
 * Ce module est le SEUL point de contact entre notre modèle et @reactflow/core.
 *
 * Types React Flow utilisés (shapes minimales — évite d'importer rf dans les composants) :
 *   RFNode = { id, type, position, data }
 *   RFEdge = { id, source, target, type, label, data }
 */
import type { WorkflowGraph, WorkflowNode, WorkflowEdge, SimOverlay } from './types';

// ─── Shapes React Flow minimales ──────────────────────────────────────────────

export interface RFNode {
  id:       string;
  type:     string;    // 'workflowState'
  position: { x: number; y: number };
  data:     RFNodeData;
}

export interface RFNodeData {
  label:           string;
  stateType:       'initial' | 'state' | 'terminal';
  transitionCount: number;
  simStatus?:      'reached' | 'blocked' | 'unreached';
}

export interface RFEdge {
  id:           string;
  source:       string;
  target:       string;
  type:         string;   // 'workflowTransition'
  label:        string;
  animated?:    boolean;
  data:         RFEdgeData;
}

export interface RFEdgeData {
  action:      string;
  guards:      string[];
  permission:  string;
  sideEffects: string[];
  simStatus?:  'reached' | 'blocked';
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ReactFlowAdapter {
  /**
   * WorkflowGraph → {nodes, edges} React Flow
   */
  static toReactFlow(
    graph:   WorkflowGraph,
    simOverlay?: SimOverlay,
  ): { nodes: RFNode[]; edges: RFEdge[] } {
    // Compter les transitions sortantes par état
    const outCount = new Map<string, number>();
    graph.edges.forEach(e => {
      outCount.set(e.source, (outCount.get(e.source) ?? 0) + 1);
    });

    const nodes: RFNode[] = graph.nodes.map(n => ({
      id:       n.id,
      type:     'workflowState',
      position: n.position,
      data: {
        label:           n.label,
        stateType:       n.type,
        transitionCount: outCount.get(n.id) ?? 0,
        simStatus:       simOverlay?.[n.id],
      },
    }));

    const edges: RFEdge[] = graph.edges.map(e => {
      const edgeSimStatus = simOverlay?.[e.id] as 'reached' | 'blocked' | undefined;
      return {
        id:       e.id,
        source:   e.source,
        target:   e.target,
        type:     'workflowTransition',
        label:    e.label,
        animated: edgeSimStatus === 'reached',
        data: {
          action:      e.label,
          guards:      e.guards,
          permission:  e.permission,
          sideEffects: e.sideEffects,
          simStatus:   edgeSimStatus,
        },
      };
    });

    return { nodes, edges };
  }

  /**
   * {nodes, edges} React Flow → WorkflowGraph
   * Appelé après drag & drop ou édition dans le designer.
   */
  static fromReactFlow(
    rfNodes:    RFNode[],
    rfEdges:    RFEdge[],
    entityType: string,
    version:    string = '1.0.0',
  ): WorkflowGraph {
    const nodes: WorkflowNode[] = rfNodes.map(n => ({
      id:       n.id,
      label:    n.data.label,
      type:     n.data.stateType,
      position: n.position,
      metadata: {},
    }));

    const edges: WorkflowEdge[] = rfEdges.map(e => ({
      id:          e.id,
      source:      e.source,
      target:      e.target,
      label:       e.data.action || String(e.label),
      guards:      e.data.guards ?? [],
      permission:  e.data.permission ?? '',
      sideEffects: e.data.sideEffects ?? [],
      metadata:    {},
    }));

    return {
      entityType,
      nodes,
      edges,
      version,
      checksum: '',
      metadata: {},
    };
  }

  /**
   * Construit un SimOverlay à partir d'un SimResult.
   * Les nœuds atteints → 'reached', l'arête bloquante → 'blocked', reste → 'unreached'.
   */
  static buildSimOverlay(
    simResult: {
      reachedStates:     string[];
      unreachableStates: string[];
      steps:             Array<{ edgeId: string; reachable: boolean }>;
    },
  ): SimOverlay {
    const overlay: SimOverlay = {};

    for (const s of simResult.reachedStates) overlay[s] = 'reached';
    for (const s of simResult.unreachableStates) overlay[s] = 'unreached';

    for (const step of simResult.steps) {
      overlay[step.edgeId] = step.reachable ? 'reached' : 'blocked';
    }

    return overlay;
  }
}
