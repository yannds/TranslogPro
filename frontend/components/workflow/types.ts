/**
 * Types frontend workflow — indépendants de React Flow.
 * Miroir des types backend graph.types.ts, enrichis pour l'UI.
 */

export type NodeType = 'initial' | 'state' | 'terminal';

export interface WorkflowNode {
  id:       string;
  label:    string;
  type:     NodeType;
  position: { x: number; y: number };
  metadata: Record<string, unknown>;
}

export interface WorkflowEdge {
  id:          string;
  source:      string;
  target:      string;
  label:       string;
  guards:      string[];
  permission:  string;
  sideEffects: string[];
  metadata:    Record<string, unknown>;
}

export interface WorkflowGraph {
  entityType: string;
  nodes:      WorkflowNode[];
  edges:      WorkflowEdge[];
  version:    string;
  checksum:   string;
  metadata:   Record<string, unknown>;
}

// ─── Simulation ────────────────────────────────────────────────────────────────

export interface CapturedSideEffectSummary {
  name:    string;
  payload: Record<string, unknown>;
}

export interface SimStep {
  edgeId:       string;
  action:       string;
  fromState:    string;
  toState:      string;
  guardResult:  Record<string, boolean | null>;
  permGranted:  boolean;
  permission?:  string;
  reachable:    boolean;
  capturedSideEffects?: CapturedSideEffectSummary[];
  errorMessage?: string;
}

export type StepReason =
  | 'success'
  | 'permission_denied'
  | 'guard_blocked'
  | 'transition_unknown';

export interface StructuredStep {
  reason:                StepReason;
  action:                string;
  fromState:             string;
  toState:               string;
  missingPermission?:    string;
  rolesWithPermission?:  string[];
  guardName?:            string;
  errorMessage?:         string;
}

export type ConclusionType =
  | 'all_success'
  | 'try_other_roles'
  | 'no_permission_owner'
  | 'states_unreachable';

export interface StructuredConclusion {
  type:                ConclusionType;
  rolesSuggested?:     string[];
  missingPermissions?: string[];
  unreachableStates?:  string[];
}

export interface HumanSummary {
  roleName:           string;
  ignoredPermissions: boolean;
  totalCount:         number;
  successCount:       number;
  perStep:            StructuredStep[];
  conclusion?:        StructuredConclusion;
}

export interface SimResult {
  entityType:        string;
  initialState:      string;
  finalState:        string;
  steps:             SimStep[];
  reachedStates:     string[];
  unreachableStates: string[];
  finalEntity?:      Record<string, unknown>;
  humanSummary?:     HumanSummary;
}

// ─── Marketplace ───────────────────────────────────────────────────────────────

export interface BlueprintSummary {
  id:             string;
  name:           string;
  slug:           string;
  description?:   string;
  entityType:     string;
  version:        string;
  isPublic:       boolean;
  isSystem:       boolean;
  usageCount:     number;
  tags:           string[];
  category?:      { name: string; icon?: string };
  _count?:        { installs: number };
  installs?:      Array<{ installedAt: string; isDirty: boolean }>;
}

export interface BlueprintDetail extends BlueprintSummary {
  graphJson: WorkflowGraph;
  checksum:  string;
  createdAt: string;
  updatedAt: string;
}

// ─── Propriétés partagées des composants ──────────────────────────────────────

export type SimOverlay = Record<string, 'reached' | 'blocked' | 'unreached'>;
