/**
 * layoutGraph — disposition automatique d'un workflow en colonnes BFS.
 *
 * Algorithme :
 *   1. BFS depuis les nœuds initiaux pour assigner une "profondeur" à chaque nœud.
 *   2. Les nœuds non atteints (orphelins, états terminaux isolés) sont placés
 *      dans une colonne après les autres.
 *   3. Pour chaque colonne (même profondeur), on distribue verticalement.
 *
 * Pas de dépendance externe (dagre/elkjs) — graphes workflow restent petits
 * (< 50 nœuds typiquement), un layout colonné simple suffit largement.
 */
import type { WorkflowNode, WorkflowEdge } from './types';

const COLUMN_GAP = 240;
const ROW_GAP    = 130;
const ORIGIN_X   = 60;
const ORIGIN_Y   = 60;

export interface LayoutResult {
  nodes: WorkflowNode[];
}

export function layoutGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): LayoutResult {
  if (nodes.length === 0) return { nodes: [] };

  // Index pour accès rapide
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) outgoing.set(n.id, []);
  for (const e of edges) {
    if (e.source === e.target) continue; // boucles ignorées pour la profondeur
    const list = outgoing.get(e.source);
    if (list) list.push(e.target);
  }

  // Profondeur par BFS depuis chaque nœud initial
  const depth = new Map<string, number>();
  const initials = nodes.filter(n => n.type === 'initial').map(n => n.id);
  // S'il n'y a pas de "initial", on prend les nœuds sans entrée
  const startNodes = initials.length > 0
    ? initials
    : nodes.filter(n => !edges.some(e => e.target === n.id)).map(n => n.id);

  const queue: string[] = [];
  for (const id of startNodes) {
    if (!depth.has(id)) {
      depth.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const d = depth.get(current)!;
    for (const next of outgoing.get(current) ?? []) {
      const existing = depth.get(next);
      // Plus longue chaîne gagne — favorise un layout left-to-right cohérent
      if (existing === undefined || existing < d + 1) {
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
  }

  // Nœuds non atteints (cycles purs ou isolés) → colonne après le max
  const maxKnownDepth = depth.size > 0
    ? Math.max(...depth.values())
    : -1;
  const orphanCol = maxKnownDepth + 1;
  for (const n of nodes) {
    if (!depth.has(n.id)) depth.set(n.id, orphanCol);
  }

  // Grouper par colonne
  const cols = new Map<number, string[]>();
  for (const [id, d] of depth.entries()) {
    const list = cols.get(d) ?? [];
    list.push(id);
    cols.set(d, list);
  }

  // Tri à l'intérieur de chaque colonne : terminaux en bas, autres par label alpha
  // (déterministe → l'utilisateur retrouve ses repères entre deux relayouts)
  for (const list of cols.values()) {
    list.sort((a, b) => {
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      const aTerm = na.type === 'terminal' ? 1 : 0;
      const bTerm = nb.type === 'terminal' ? 1 : 0;
      if (aTerm !== bTerm) return aTerm - bTerm;
      return na.label.localeCompare(nb.label);
    });
  }

  // Position
  const positioned = nodes.map(n => {
    const col = depth.get(n.id) ?? 0;
    const row = (cols.get(col) ?? []).indexOf(n.id);
    const colSize = (cols.get(col) ?? []).length;
    // Centrage vertical de chaque colonne autour de Y=300 (esthétique)
    const yOffset = -((colSize - 1) * ROW_GAP) / 2 + 300;
    return {
      ...n,
      position: {
        x: ORIGIN_X + col * COLUMN_GAP,
        y: ORIGIN_Y + row * ROW_GAP + yOffset,
      },
    };
  });

  return { nodes: positioned };
}
