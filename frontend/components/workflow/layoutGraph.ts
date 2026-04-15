/**
 * layoutGraph — disposition automatique d'un workflow via dagre (layered layout).
 *
 * Pourquoi dagre :
 *   Les workflows contiennent des cycles (retours d'état, incidents, pauses),
 *   qu'un simple BFS en colonnes ne gère pas : tous les états finissent collés
 *   dans les mêmes rangées, les arêtes et labels se superposent.
 *   Dagre casse les cycles, répartit les nœuds en couches (rank) gauche→droite
 *   et espace les rangs/nœuds suffisamment pour que les labels de transition
 *   tiennent entre deux niveaux.
 *
 * Orientation : LR (left-to-right), conforme à l'UX de lecture des workflows.
 */
import dagre from '@dagrejs/dagre';
import type { WorkflowNode, WorkflowEdge } from './types';

const NODE_WIDTH  = 180;
const NODE_HEIGHT = 70;
const RANK_SEP    = 120;  // écart horizontal entre couches
const NODE_SEP    = 60;   // écart vertical entre nœuds d'une même couche
const EDGE_SEP    = 40;   // marge pour les labels de transition

export interface LayoutResult {
  nodes: WorkflowNode[];
}

export function layoutGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): LayoutResult {
  if (nodes.length === 0) return { nodes: [] };

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir:  'LR',
    ranksep:  RANK_SEP,
    nodesep:  NODE_SEP,
    edgesep:  EDGE_SEP,
    marginx:  40,
    marginy:  40,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    if (e.source === e.target) continue; // self-loops : dagre les gère mal, on ignore pour le rank
    // multigraph → id unique par arête (action peut se répéter)
    g.setEdge(e.source, e.target, {}, e.id);
  }

  dagre.layout(g);

  // Dagre positionne au centre du nœud → on convertit vers top-left (ReactFlow)
  const positioned = nodes.map(n => {
    const d = g.node(n.id);
    return {
      ...n,
      position: d
        ? { x: d.x - NODE_WIDTH / 2, y: d.y - NODE_HEIGHT / 2 }
        : n.position ?? { x: 0, y: 0 },
    };
  });

  return { nodes: positioned };
}
