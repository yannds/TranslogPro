/**
 * SimulationWorkflowIO
 *
 * I/O en mémoire pour simuler une transition fidèlement, sans toucher à la DB.
 *
 * Principe de fidélité :
 *   - Permissions : lues dans la VRAIE DB (rolePermission) — un profil simulé
 *     passe exactement les mêmes contrôles qu'en prod.
 *   - Config workflow : fournie explicitement via le graphe (le designer édite
 *     un graphe non-persisté — on simule CE graphe, pas celui en DB).
 *   - Transaction : pas de vraie transaction Prisma — les opérations sont
 *     des mutations en mémoire sur une entité sandbox.
 *   - Idempotence & versioning : gérés en mémoire, même algorithme que live.
 *   - Side-effects : capturés (jamais exécutés) — on retourne la liste.
 *   - Audit : capturé (jamais écrit en DB) — on retourne la liste.
 *
 * Usage (Sprint 3) :
 *   const io = new SimulationWorkflowIO(prisma, graph);
 *   const result = await engine.transition(sandboxEntity, input, config, io);
 *   console.log(io.captured);  // side-effects, audit, transitions
 */
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkflowGraph } from '../types/graph.types';
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';
import { SideEffectDefinition } from '../types/side-effect-definition.type';
import { AuditEntry } from '../audit.service';
import {
  IWorkflowIO,
  IWorkflowTxIO,
  IdempotentTransitionSummary,
  ResolvedWorkflowConfig,
  PersistFn,
} from './workflow-io.interface';

/** Enregistrement capturé par la simulation pour restitution UI. */
export interface CapturedSideEffect {
  name:   string;
  entity: Record<string, unknown>;
  input:  { action: string; actorId: string };
  ctx:    Record<string, unknown>;
}

export interface CapturedAudit extends AuditEntry {
  capturedAt: string;
}

export interface CapturedTransition {
  entityType:     string;
  entityId:       string;
  fromState:      string;
  toState:        string;
  action:         string;
  userId:         string;
  idempotencyKey: string;
}

export interface SimulationCapture {
  sideEffects:  CapturedSideEffect[];
  auditEntries: CapturedAudit[];
  transitions:  CapturedTransition[];
}

// ─── Transactional IO ─────────────────────────────────────────────────────────

class SimulationWorkflowTxIO implements IWorkflowTxIO {
  constructor(
    private readonly parent: SimulationWorkflowIO,
  ) {}

  async findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null> {
    const existing = this.parent.transitions.find(t => t.idempotencyKey === idempotencyKey);
    if (!existing) return null;
    return { toState: existing.toState, fromState: existing.fromState };
  }

  async lockEntity(
    aggregateType: string,
    entityId:      string,
  ): Promise<{ version: number } | null> {
    // En simulation, l'entité sandbox est connue — pas de vrai lock.
    // On retourne sa version courante (sinon null si non-sandbox).
    const ent = this.parent.currentEntity;
    if (!ent) return null;
    if (ent.id !== entityId) return null;
    // La whitelist d'aggregateType est validée en amont via supportsAggregateType.
    void aggregateType;
    return { version: ent.version };
  }

  async persist<E extends WorkflowEntity>(
    entity:    E,
    toState:   string,
    _persistFn: PersistFn<E>,
  ): Promise<E> {
    // On N'APPELLE PAS persistFn : en prod elle touche la DB (Prisma).
    // En simulation, on applique la mutation minimale : status + version++.
    // C'est exactement ce que la prod fait (contractuellement : persistFn DOIT
    // incrémenter version pour le lock optimiste).
    const updated = { ...entity, status: toState, version: entity.version + 1 } as E;
    this.parent.currentEntity = updated;
    return updated;
  }

  async recordTransition(data: {
    tenantId:       string;
    entityType:     string;
    entityId:       string;
    fromState:      string;
    action:         string;
    toState:        string;
    userId:         string;
    idempotencyKey: string;
  }): Promise<void> {
    this.parent.transitions.push({
      entityType:     data.entityType,
      entityId:       data.entityId,
      fromState:      data.fromState,
      toState:        data.toState,
      action:         data.action,
      userId:         data.userId,
      idempotencyKey: data.idempotencyKey,
    });
  }

  async recordAudit(entry: AuditEntry): Promise<void> {
    this.parent.auditEntries.push({
      ...entry,
      capturedAt: new Date().toISOString(),
    });
  }

  async runSideEffect<E extends WorkflowEntity>(
    sideEffect: SideEffectDefinition<E>,
    entity:     E,
    input:      TransitionInput,
    context:    Record<string, unknown>,
  ): Promise<void> {
    // CAPTURE seulement — on N'EXECUTE PAS la fonction pour éviter d'envoyer
    // des SMS, webhooks, ou toute mutation externe pendant la simulation.
    this.parent.sideEffects.push({
      name:   sideEffect.name,
      entity: { ...entity } as Record<string, unknown>,
      input:  { action: input.action, actorId: input.actor.id },
      ctx:    { ...context },
    });
  }
}

// ─── Root IO ──────────────────────────────────────────────────────────────────

export class SimulationWorkflowIO implements IWorkflowIO {
  /** Graphe utilisé pour résoudre les configs (au lieu de la DB). */
  private readonly graph: WorkflowGraph;

  /**
   * Entité sandbox courante — mutée au fil des étapes pour permettre plusieurs
   * transitions successives dans une même simulation (scénario complet).
   */
  public currentEntity: WorkflowEntity | null = null;

  // Buffers de capture — lus par le service de simulation pour la timeline UI
  public readonly sideEffects:  CapturedSideEffect[]  = [];
  public readonly auditEntries: CapturedAudit[]       = [];
  public readonly transitions:  CapturedTransition[]  = [];

  constructor(
    private readonly prisma: PrismaService,
    graph: WorkflowGraph,
    /**
     * Quand true, les permissions ne sont jamais vérifiées en DB.
     * Utilisé lorsque le designer simule sans rôle spécifique ("sudo" conception).
     */
    private readonly ignorePermissions: boolean = false,
  ) {
    this.graph = graph;
  }

  /** Définit l'entité sandbox active avant chaque transition. */
  setEntity(entity: WorkflowEntity): void {
    this.currentEntity = entity;
  }

  supportsAggregateType(aggregateType: string): boolean {
    // En simulation, on accepte tout entityType pour lequel le graphe est défini.
    // Le designer peut concevoir un workflow pour n'importe quel type métier.
    return this.graph.entityType === aggregateType;
  }

  async findIdempotentTransition(
    idempotencyKey: string,
  ): Promise<IdempotentTransitionSummary | null> {
    const existing = this.transitions.find(t => t.idempotencyKey === idempotencyKey);
    if (!existing) return null;
    return { toState: existing.toState, fromState: existing.fromState };
  }

  async loadConfig(
    tenantId:   string,
    entityType: string,
    fromState:  string,
    action:     string,
  ): Promise<ResolvedWorkflowConfig | null> {
    void tenantId; // non utilisé en simulation — le graphe est déjà scopé
    if (this.graph.entityType !== entityType) return null;

    const edge = this.graph.edges.find(
      e => e.source === fromState && e.label === action,
    );
    if (!edge) return null;

    return {
      toState:         edge.target,
      requiredPerm:    edge.permission ?? '',
      sideEffectNames: Array.isArray(edge.sideEffects) ? (edge.sideEffects as string[]) : [],
    };
  }

  async hasPermission(roleId: string, permission: string): Promise<boolean> {
    // Mode "sudo conception" : pas de rôle simulé → on n'évalue pas les permissions.
    if (this.ignorePermissions) return true;
    // FIDÉLITÉ : vraie requête DB — un rôle qui passe ici passe aussi en prod.
    // Permission vide = transition libre (blueprint sans permission) → autorise.
    if (!permission) return true;
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId, permission },
    });
    return rp !== null;
  }

  async runInTransaction<T>(
    fn: (txIO: IWorkflowTxIO) => Promise<T>,
  ): Promise<T> {
    // Pas de vraie transaction — aucune mutation DB à protéger.
    // Les mutations se font en mémoire via SimulationWorkflowTxIO.
    return fn(new SimulationWorkflowTxIO(this));
  }

  /** Snapshot des captures pour restitution à l'UI. */
  getCapture(): SimulationCapture {
    return {
      sideEffects:  [...this.sideEffects],
      auditEntries: [...this.auditEntries],
      transitions:  [...this.transitions],
    };
  }
}
