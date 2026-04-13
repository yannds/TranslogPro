/**
 * WorkflowGraph — types UI-agnostiques (indépendants de React Flow)
 *
 * Ces interfaces servent d'intermédiaire entre :
 *   - La représentation DB  : WorkflowConfig[] (table `workflow_configs`)
 *   - La représentation FE  : React Flow {nodes[], edges[]}
 *   - La représentation export : WorkflowBlueprint.graphJson
 *
 * Règle d'or : aucune dépendance sur @reactflow/* ici.
 * Le ReactFlowAdapter dans le frontend fait la conversion.
 */

/** Type sémantique d'un état */
export type NodeType = 'initial' | 'state' | 'terminal';

/** Un nœud = un état du workflow */
export interface GraphNode {
  /** Identifiant = nom d'état DB (ex: "PENDING_PAYMENT") */
  id:       string;
  label:    string;
  type:     NodeType;
  /** Position canvas pour le designer visuel */
  position: { x: number; y: number };
  /** Données arbitraires pour extensions futures */
  metadata: Record<string, unknown>;
}

/** Une arête = une transition possible entre deux états */
export interface GraphEdge {
  /** Format: `{fromState}___{action}___{toState}` */
  id:         string;
  source:     string;   // fromState (GraphNode.id)
  target:     string;   // toState (GraphNode.id)
  /** action name (ex: "CONFIRM_PAYMENT") */
  label:      string;
  /** Noms des guards (depuis le registre connu) */
  guards:     string[];
  /** Permission requise — format: "plane.module.action.scope" */
  permission: string;
  /** Noms des side-effects (depuis le registre connu) */
  sideEffects: string[];
  metadata:   Record<string, unknown>;
}

/** Graphe complet — snapshot d'un workflow pour un entityType */
export interface WorkflowGraph {
  /** Type d'entité : Ticket | Parcel | Trip | Claim */
  entityType: string;
  nodes:      GraphNode[];
  edges:      GraphEdge[];
  /** SemVer: "1.0.0" */
  version:    string;
  /** SHA-256 de la sérialisation JSON — tamper detection */
  checksum:   string;
  metadata:   Record<string, unknown>;
}

/** Résultat de simulation Live-Path */
export interface SimulationStep {
  edgeId:    string;
  action:    string;
  fromState: string;
  toState:   string;
  /** null = non vérifié, true = ok, false = bloqué */
  guardResult:  Record<string, boolean | null>;
  /** Permission présente dans le rôle simulé */
  permGranted:  boolean;
  /** État final après cette étape */
  reachable:    boolean;
}

export interface SimulationResult {
  entityType:   string;
  initialState: string;
  finalState:   string;
  steps:        SimulationStep[];
  /** Tous les états atteints dans ce chemin */
  reachedStates: string[];
  /** États jamais atteints depuis initialState */
  unreachableStates: string[];
}

/** Registre connu des guards et side-effects (utilisé par le validateur) */
export interface WorkflowRegistry {
  guards:      string[];
  sideEffects: string[];
  permissions: string[];
}
