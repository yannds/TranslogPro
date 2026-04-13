/**
 * WorkflowGraphAdapter
 *
 * Traduit entre trois représentations :
 *   Prisma WorkflowConfig[] ←→ WorkflowGraph ←→ React Flow (nodes/edges)
 *
 * Ce fichier ne contient QUE de la transformation pure — zero side-effects,
 * zero dépendances externes, facilement testable.
 */
import { createHash } from 'crypto';
import { WorkflowGraph, GraphNode, GraphEdge, NodeType } from '../types/graph.types';

// ─── Interfaces minimales Prisma (évite d'importer @prisma/client ici) ────────

export interface PrismaWorkflowConfig {
  id:         string;
  entityType: string;
  fromState:  string;
  action:     string;
  toState:    string;
  permission?: string | null;
  requiredPerm?: string | null;
  guards:     unknown;        // Json → string[] en DB
  sideEffects: unknown;       // Json → string[] en DB
  positionX?: number | null;
  positionY?: number | null;
  metadata?:  unknown;
}

// ─── Heuristiques de position auto ────────────────────────────────────────────

const AUTO_POSITION_SPACING = { x: 220, y: 140 };

function autoPositions(states: string[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  states.forEach((s, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    positions[s] = {
      x: col * AUTO_POSITION_SPACING.x + 60,
      y: row * AUTO_POSITION_SPACING.y + 60,
    };
  });
  return positions;
}

function detectNodeType(state: string, allEdges: PrismaWorkflowConfig[]): NodeType {
  const hasIncoming = allEdges.some(e => e.toState === state);
  const hasOutgoing = allEdges.some(e => e.fromState === state);
  if (!hasIncoming) return 'initial';
  if (!hasOutgoing) return 'terminal';
  return 'state';
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class WorkflowGraphAdapter {
  /**
   * Prisma WorkflowConfig[] → WorkflowGraph
   * Appelé pour afficher le designer et pour créer un blueprint export.
   */
  static fromPrisma(configs: PrismaWorkflowConfig[], entityType: string): WorkflowGraph {
    if (configs.length === 0) {
      return WorkflowGraphAdapter.emptyGraph(entityType);
    }

    // Collecter tous les états distincts
    const stateSet = new Set<string>();
    configs.forEach(c => {
      stateSet.add(c.fromState);
      stateSet.add(c.toState);
    });
    const states = Array.from(stateSet);

    // Auto-positions si pas de coordonnées en DB
    const autoPos = autoPositions(states);

    const nodes: GraphNode[] = states.map(s => {
      // Cherche la première config qui mentionne cet état pour extraire metadata
      const ref = configs.find(c => c.fromState === s || c.toState === s);
      return {
        id:    s,
        label: s.replace(/_/g, ' '),
        type:  detectNodeType(s, configs),
        position: {
          x: (ref as any)?.positionX ?? autoPos[s]!.x,
          y: (ref as any)?.positionY ?? autoPos[s]!.y,
        },
        metadata: {},
      };
    });

    const edges: GraphEdge[] = configs.map(c => ({
      id:         `${c.fromState}___${c.action}___${c.toState}`,
      source:     c.fromState,
      target:     c.toState,
      label:      c.action,
      guards:     WorkflowGraphAdapter.parseJsonArray(c.guards),
      permission: (c.permission ?? c.requiredPerm ?? ''),
      sideEffects: WorkflowGraphAdapter.parseJsonArray(c.sideEffects),
      metadata:   {},
    }));

    const graph: WorkflowGraph = {
      entityType,
      nodes,
      edges,
      version:  '1.0.0',
      checksum: '',
      metadata: {},
    };
    graph.checksum = WorkflowGraphAdapter.computeChecksum(graph);
    return graph;
  }

  /**
   * WorkflowGraph → tableau de CreateInput Prisma
   * Appelé lors de l'installation d'un blueprint ou de la sauvegarde du designer.
   */
  static toPrismaCreateInputs(
    graph:    WorkflowGraph,
    tenantId: string,
  ): Array<{
    tenantId:    string;
    entityType:  string;
    fromState:   string;
    action:      string;
    toState:     string;
    requiredPerm: string;
    guards:      unknown;
    sideEffects: unknown;
    isActive:    boolean;
  }> {
    return graph.edges.map(e => ({
      tenantId,
      entityType:   graph.entityType,
      fromState:    e.source,
      action:       e.label,
      toState:      e.target,
      requiredPerm: e.permission,
      guards:       e.guards,
      sideEffects:  e.sideEffects,
      isActive:     true,
    }));
  }

  /**
   * Calcule un SHA-256 déterministe du graphe (nodes + edges triés).
   * Utilisé pour tamper detection lors d'un import marketplace.
   */
  static computeChecksum(graph: WorkflowGraph): string {
    const payload = {
      entityType: graph.entityType,
      nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(n => ({
        id: n.id, type: n.type,
      })),
      edges: [...graph.edges].sort((a, b) => a.id.localeCompare(b.id)).map(e => ({
        id: e.id, source: e.source, target: e.target,
        label: e.label, permission: e.permission,
        guards: [...e.guards].sort(),
        sideEffects: [...e.sideEffects].sort(),
      })),
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  /** Vérifie que le checksum d'un graphe importé est intact */
  static verifyChecksum(graph: WorkflowGraph): boolean {
    const expected = graph.checksum;
    const actual   = WorkflowGraphAdapter.computeChecksum({ ...graph, checksum: '' });
    return expected === actual;
  }

  private static emptyGraph(entityType: string): WorkflowGraph {
    return {
      entityType,
      nodes:    [],
      edges:    [],
      version:  '1.0.0',
      checksum: '',
      metadata: {},
    };
  }

  private static parseJsonArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  }
}
