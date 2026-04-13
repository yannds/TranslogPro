/**
 * WorkflowValidator
 *
 * Valide la structure d'un WorkflowGraph avant de le persister ou de l'importer.
 *
 * Règles :
 *   V1 — Au moins un nœud initial (type='initial')
 *   V2 — Au moins un nœud terminal (type='terminal')
 *   V3 — Tous les source/target d'arête référencent des nœuds existants
 *   V4 — Pas d'arête dupliquée (même id)
 *   V5 — Permission format : "plane.module.action.scope" (4 segments)
 *   V6 — Guards références registre connu (warn si inconnu)
 *   V7 — SideEffects références registre connu (warn si inconnu)
 *   V8 — Depuis l'initial, tous les états terminaux sont atteignables (DFS)
 *   V9 — Pas de nœud isolé (ni source ni target d'aucune arête)
 */
import { WorkflowGraph, WorkflowRegistry } from '../types/graph.types';

export interface ValidationError {
  code:    string;
  message: string;
  /** severity: error bloque la sauvegarde, warning est informatif */
  level:   'error' | 'warning';
  context?: Record<string, unknown>;
}

export interface ValidationResult {
  valid:    boolean;
  errors:   ValidationError[];
  warnings: ValidationError[];
}

// Registre de guards et side-effects connus dans TranslogPro.
// Les noms correspondent aux GuardDefinition.name utilisés dans les services métier.
export const DEFAULT_REGISTRY: WorkflowRegistry = {
  guards: [
    'checkSoldeAgent',
    'checkTicketNotScanned',
    'checkParcelNotDelivered',
    'checkTripNotDeparted',
    'checkTripDeparted',
    'checkCapacityAvailable',
    'checkRefundWindow',
    'checkClaimDeadline',
    'checkBusOperational',
    'checkDriverAssigned',
    'checkPaymentConfirmed',
    'checkManifestSigned',
    'checkWeightLimit',
    'checkSenderVerified',
  ],
  sideEffects: [
    'notifyPassenger',
    'notifyDriver',
    'notifyAgency',
    'updateSeatMap',
    'generateTicketQR',
    'generateParcelLabel',
    'updateManifest',
    'triggerRefund',
    'triggerOutboxNotification',
    'updateParcelTracking',
    'createAuditEntry',
    'markCashierTransaction',
    'releaseSeat',
    'archiveTicket',
    'archiveParcel',
  ],
  permissions: [], // validé dynamiquement si non vide
};

export class WorkflowValidator {
  constructor(private readonly registry: WorkflowRegistry = DEFAULT_REGISTRY) {}

  validate(graph: WorkflowGraph): ValidationResult {
    const errors:   ValidationError[] = [];
    const warnings: ValidationError[] = [];

    const nodeIds = new Set(graph.nodes.map(n => n.id));
    const edgeIds = new Set<string>();

    // V1 — nœud initial
    const initials = graph.nodes.filter(n => n.type === 'initial');
    if (initials.length === 0) {
      errors.push({
        code:    'V1_NO_INITIAL_STATE',
        message: 'Le graphe doit avoir au moins un état initial (type="initial")',
        level:   'error',
      });
    }

    // V2 — nœud terminal
    const terminals = graph.nodes.filter(n => n.type === 'terminal');
    if (terminals.length === 0) {
      errors.push({
        code:    'V2_NO_TERMINAL_STATE',
        message: 'Le graphe doit avoir au moins un état terminal (type="terminal")',
        level:   'error',
      });
    }

    for (const edge of graph.edges) {
      // V3 — source/target existants
      if (!nodeIds.has(edge.source)) {
        errors.push({
          code:    'V3_UNKNOWN_SOURCE',
          message: `Arête "${edge.id}" : état source "${edge.source}" n'existe pas`,
          level:   'error',
          context: { edgeId: edge.id },
        });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({
          code:    'V3_UNKNOWN_TARGET',
          message: `Arête "${edge.id}" : état cible "${edge.target}" n'existe pas`,
          level:   'error',
          context: { edgeId: edge.id },
        });
      }

      // V4 — pas d'arête dupliquée
      if (edgeIds.has(edge.id)) {
        errors.push({
          code:    'V4_DUPLICATE_EDGE',
          message: `Arête dupliquée : "${edge.id}"`,
          level:   'error',
          context: { edgeId: edge.id },
        });
      }
      edgeIds.add(edge.id);

      // V5 — format permission
      if (edge.permission) {
        const segments = edge.permission.split('.');
        if (segments.length !== 4) {
          errors.push({
            code:    'V5_INVALID_PERMISSION_FORMAT',
            message: `Arête "${edge.id}" : permission "${edge.permission}" invalide (attendu: plane.module.action.scope)`,
            level:   'error',
            context: { edgeId: edge.id, permission: edge.permission },
          });
        }
        const scope = segments[3];
        if (!['own', 'agency', 'tenant', 'global'].includes(scope ?? '')) {
          errors.push({
            code:    'V5_INVALID_PERMISSION_SCOPE',
            message: `Arête "${edge.id}" : scope "${scope}" invalide (own|agency|tenant|global)`,
            level:   'error',
            context: { edgeId: edge.id, scope },
          });
        }
      } else {
        errors.push({
          code:    'V5_MISSING_PERMISSION',
          message: `Arête "${edge.id}" : permission manquante`,
          level:   'error',
          context: { edgeId: edge.id },
        });
      }

      // V6 — guards connus
      for (const guard of edge.guards) {
        if (!this.registry.guards.includes(guard)) {
          warnings.push({
            code:    'V6_UNKNOWN_GUARD',
            message: `Arête "${edge.id}" : guard "${guard}" inconnu du registre`,
            level:   'warning',
            context: { edgeId: edge.id, guard },
          });
        }
      }

      // V7 — side-effects connus
      for (const se of edge.sideEffects) {
        if (!this.registry.sideEffects.includes(se)) {
          warnings.push({
            code:    'V7_UNKNOWN_SIDE_EFFECT',
            message: `Arête "${edge.id}" : side-effect "${se}" inconnu du registre`,
            level:   'warning',
            context: { edgeId: edge.id, sideEffect: se },
          });
        }
      }
    }

    // V8 — Atteignabilité (DFS depuis initial → terminaux)
    if (initials.length > 0 && terminals.length > 0 && errors.length === 0) {
      const adjacency = new Map<string, string[]>();
      graph.nodes.forEach(n => adjacency.set(n.id, []));
      graph.edges.forEach(e => {
        adjacency.get(e.source)?.push(e.target);
      });

      const reached = new Set<string>();
      const dfs = (state: string) => {
        if (reached.has(state)) return;
        reached.add(state);
        for (const next of adjacency.get(state) ?? []) {
          dfs(next);
        }
      };
      for (const init of initials) dfs(init.id);

      const unreachableTerminals = terminals.filter(t => !reached.has(t.id));
      if (unreachableTerminals.length > 0) {
        errors.push({
          code:    'V8_TERMINAL_UNREACHABLE',
          message: `État(s) terminal(aux) inaccessible(s) depuis l'état initial : ${unreachableTerminals.map(t => t.id).join(', ')}`,
          level:   'error',
          context: { unreachable: unreachableTerminals.map(t => t.id) },
        });
      }
    }

    // V9 — nœuds isolés
    const connectedNodes = new Set<string>();
    graph.edges.forEach(e => { connectedNodes.add(e.source); connectedNodes.add(e.target); });
    for (const node of graph.nodes) {
      if (!connectedNodes.has(node.id) && graph.nodes.length > 1) {
        warnings.push({
          code:    'V9_ISOLATED_NODE',
          message: `État "${node.id}" n'est connecté à aucune transition`,
          level:   'warning',
          context: { nodeId: node.id },
        });
      }
    }

    return {
      valid:    errors.length === 0,
      errors,
      warnings,
    };
  }
}
