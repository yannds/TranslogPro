/**
 * SimulationSessionService
 *
 * Gère les sessions de simulation en mode breakpoint :
 *   - Création d'une session avec graphe + actor + séquence d'actions + breakpoints
 *   - Avancement pas-à-pas (step) — exécute une action à la fois
 *   - Reprise jusqu'au prochain breakpoint (continue)
 *   - Nettoyage explicite ou TTL 30min
 *
 * Stockage : Redis (clé `simulate:session:<id>`) — state sérialisable en JSON.
 * Pas de DB : la simulation n'écrit jamais, donc la session ne persiste rien
 * au-delà du TTL.
 */
import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { SimulationWorkflowIO } from '../../core/workflow/io/simulation-workflow.io';
import { EntityFactoryRegistry } from '../../core/workflow/io/entity-factory.registry';
import { GuardDefinition } from '../../core/workflow/types/guard-definition.type';
import { WorkflowEntity } from '../../core/workflow/interfaces/workflow-entity.interface';
import { WorkflowGraph, SimulationStep, CapturedSideEffectSummary } from '../../core/workflow/types/graph.types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** État sérialisable d'une session (stocké en Redis). */
interface SessionState {
  sessionId:          string;
  tenantId:           string;
  entityType:         string;
  graph:              WorkflowGraph;
  /** Séquence d'actions prévue. */
  actions:            string[];
  /** Index de l'action courante (pointeur). */
  cursor:             number;
  /** Indices des étapes à arrêter pour inspection (breakpoints). */
  breakpoints:        number[];
  /** Paramètres de simulation. */
  simulatedRoleId?:   string;
  initialState:       string;
  context:            Record<string, unknown>;
  /** Snapshot de l'entité sandbox courante. */
  entity:             Record<string, unknown>;
  /** Résultats accumulés étape par étape. */
  steps:              SimulationStep[];
  /** États atteints. */
  reachedStates:      string[];
  /** Statut de la session. */
  status:             'ready' | 'running' | 'paused' | 'completed' | 'blocked';
  createdAt:          string;
  updatedAt:          string;
}

export interface CreateSessionDto {
  entityType:       string;
  initialState:     string;
  actions:          string[];
  breakpoints?:     number[];
  simulatedRoleId?: string;
  context?:         Record<string, unknown>;
  graph?:           WorkflowGraph;
  blueprintId?:     string;
}

export interface SessionSnapshot {
  sessionId:       string;
  entityType:      string;
  actions:         string[];
  cursor:          number;
  breakpoints:     number[];
  status:          SessionState['status'];
  steps:           SimulationStep[];
  currentState:    string;
  finalState:      string;
  reachedStates:   string[];
  currentEntity:   Record<string, unknown>;
  /** Côté UI : l'étape exacte en attente (si paused). */
  nextAction?:     string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 30 * 60; // 30 minutes
const SESSION_KEY_PREFIX  = 'simulate:session:';

function redisKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SimulationSessionService {
  private readonly logger = new Logger(SimulationSessionService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngine,
  ) {}

  // ─── Création ─────────────────────────────────────────────────────────────

  async createSession(tenantId: string, dto: CreateSessionDto): Promise<SessionSnapshot> {
    // Résoudre le graphe (même logique que simulateWorkflow).
    let graph: WorkflowGraph;
    if (dto.graph) {
      graph = dto.graph;
    } else if (dto.blueprintId) {
      const bp = await this.prisma.workflowBlueprint.findFirst({
        where: { id: dto.blueprintId, OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }] },
      });
      if (!bp) throw new NotFoundException(`Blueprint ${dto.blueprintId} introuvable`);
      graph = bp.graphJson as unknown as WorkflowGraph;
    } else {
      throw new BadRequestException(`Session requiert un graphe (graph) ou un blueprintId`);
    }

    if (!EntityFactoryRegistry.supports(dto.entityType)) {
      throw new BadRequestException(
        `Pas de factory sandbox pour entityType="${dto.entityType}"`,
      );
    }

    const sandbox = EntityFactoryRegistry.create({
      entityType:   dto.entityType,
      tenantId,
      initialState: dto.initialState,
      overrides:    dto.context ?? {},
    });

    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const state: SessionState = {
      sessionId,
      tenantId,
      entityType:      dto.entityType,
      graph,
      actions:         dto.actions,
      cursor:          0,
      breakpoints:     dto.breakpoints ?? [],
      simulatedRoleId: dto.simulatedRoleId,
      initialState:    dto.initialState,
      context:         dto.context ?? {},
      entity:          sandbox as Record<string, unknown>,
      steps:           [],
      reachedStates:   [dto.initialState],
      status:          'ready',
      createdAt:       now,
      updatedAt:       now,
    };

    await this.persist(state);
    this.logger.log(`Session simulation créée ${sessionId} tenant=${tenantId} entity=${dto.entityType}`);
    return this.snapshot(state);
  }

  // ─── Lecture ─────────────────────────────────────────────────────────────

  async getSession(tenantId: string, sessionId: string): Promise<SessionSnapshot> {
    const state = await this.load(tenantId, sessionId);
    return this.snapshot(state);
  }

  // ─── Step / Continue ─────────────────────────────────────────────────────

  /** Exécute UNE action et pause. */
  async stepSession(tenantId: string, sessionId: string): Promise<SessionSnapshot> {
    const state = await this.load(tenantId, sessionId);
    if (state.status === 'completed' || state.status === 'blocked') {
      return this.snapshot(state);
    }
    await this.runOne(state);
    state.status = (state.status as SessionState['status']) === 'blocked' ? 'blocked' :
                   state.cursor >= state.actions.length ? 'completed' : 'paused';
    await this.persist(state);
    return this.snapshot(state);
  }

  /** Exécute jusqu'au prochain breakpoint ou fin. */
  async continueSession(tenantId: string, sessionId: string): Promise<SessionSnapshot> {
    const state = await this.load(tenantId, sessionId);
    if (state.status === 'completed' || state.status === 'blocked') {
      return this.snapshot(state);
    }
    state.status = 'running';
    while (state.cursor < state.actions.length) {
      await this.runOne(state);
      if ((state.status as SessionState['status']) === 'blocked') break;
      // Breakpoint juste APRÈS l'étape qu'on vient d'exécuter ?
      if (state.breakpoints.includes(state.cursor)) {
        state.status = 'paused';
        break;
      }
    }
    if ((state.status as SessionState['status']) !== 'blocked' && (state.status as SessionState['status']) !== 'paused') {
      state.status = 'completed';
    }
    await this.persist(state);
    return this.snapshot(state);
  }

  // ─── Suppression ─────────────────────────────────────────────────────────

  async deleteSession(tenantId: string, sessionId: string): Promise<void> {
    const state = await this.load(tenantId, sessionId);
    await this.redis.del(redisKey(state.sessionId));
    this.logger.log(`Session simulation supprimée ${sessionId}`);
  }

  // ─── Exécution d'une étape ───────────────────────────────────────────────

  private async runOne(state: SessionState): Promise<void> {
    const action = state.actions[state.cursor];
    if (!action) return;

    const currentState = state.steps.length > 0
      ? state.steps[state.steps.length - 1]!.toState
      : state.initialState;

    const edge = state.graph.edges.find(
      e => e.source === currentState && e.label === action,
    );

    if (!edge) {
      state.steps.push({
        edgeId:      `${currentState}|${action}`,
        action,
        fromState:   currentState,
        toState:     currentState,
        guardResult: {},
        permGranted: false,
        reachable:   false,
        errorMessage: `Aucune transition ${currentState} → ${action}`,
      });
      state.status = 'blocked';
      state.cursor++;
      return;
    }

    // Résoudre l'acteur simulé (identique à simulateWorkflow).
    let simulatedActor = {
      id:       'sandbox-actor',
      tenantId: state.tenantId,
      roleId:   'sandbox-role',
      roleName: 'Simulation',
      agencyId: 'sandbox-agency',
    };
    const ignorePermissions = !state.simulatedRoleId;
    if (state.simulatedRoleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: state.simulatedRoleId },
        select: { id: true, name: true, tenantId: true },
      });
      if (role && role.tenantId === state.tenantId) {
        simulatedActor = {
          id:       `sandbox-user-${role.id}`,
          tenantId: state.tenantId,
          roleId:   role.id,
          roleName: role.name,
          agencyId: 'sandbox-agency',
        };
      }
    }

    const io = new SimulationWorkflowIO(this.prisma, state.graph, ignorePermissions);
    io.setEntity(state.entity as unknown as WorkflowEntity);

    const guardResults: Record<string, boolean | null> = {};
    const dynamicGuards: GuardDefinition<WorkflowEntity>[] = edge.guards.map(name => ({
      name,
      fn: async (_e, _i, ctx) => {
        const specified = name in ctx;
        const value = specified ? Boolean(ctx[name]) : true;
        guardResults[name] = specified ? Boolean(ctx[name]) : null;
        return value;
      },
    }));

    const dynamicSideEffects = edge.sideEffects.map(name => ({
      name,
      fn: async () => { /* no-op */ },
    }));

    const sideEffectsBefore = io.sideEffects.length;

    try {
      const result = await this.engine.transition(
        state.entity as unknown as WorkflowEntity,
        { action, actor: simulatedActor, context: state.context },
        {
          aggregateType: state.entityType,
          guards:        dynamicGuards,
          sideEffects:   dynamicSideEffects,
          persist: async (e, toState) => ({ ...e, status: toState, version: e.version + 1 } as typeof e),
        },
        io,
      );

      const stepSideEffects: CapturedSideEffectSummary[] = io.sideEffects
        .slice(sideEffectsBefore)
        .map(se => ({ name: se.name, payload: se.entity }));

      state.steps.push({
        edgeId:      edge.id,
        action,
        fromState:   currentState,
        toState:     result.toState,
        guardResult: guardResults,
        permGranted: true,
        permission:  edge.permission,
        reachable:   true,
        capturedSideEffects: stepSideEffects,
      });
      state.entity = { ...result.entity } as Record<string, unknown>;
      if (!state.reachedStates.includes(result.toState)) {
        state.reachedStates.push(result.toState);
      }
    } catch (err) {
      const isForbidden = err instanceof ForbiddenException;
      state.steps.push({
        edgeId:       edge.id,
        action,
        fromState:    currentState,
        toState:      currentState,
        guardResult:  guardResults,
        permGranted:  !isForbidden,
        permission:   edge.permission,
        reachable:    false,
        errorMessage: (err as Error).message,
        capturedSideEffects: [],
      });
      state.status = 'blocked';
    }

    state.cursor++;
    state.updatedAt = new Date().toISOString();
  }

  // ─── Helpers Redis ───────────────────────────────────────────────────────

  private async persist(state: SessionState): Promise<void> {
    state.updatedAt = new Date().toISOString();
    await this.redis.setex(
      redisKey(state.sessionId),
      SESSION_TTL_SECONDS,
      JSON.stringify(state),
    );
  }

  private async load(tenantId: string, sessionId: string): Promise<SessionState> {
    const raw = await this.redis.get(redisKey(sessionId));
    if (!raw) throw new NotFoundException(`Session ${sessionId} introuvable ou expirée`);
    const state = JSON.parse(raw) as SessionState;
    if (state.tenantId !== tenantId) {
      throw new ForbiddenException(`Session ${sessionId} n'appartient pas à ce tenant`);
    }
    return state;
  }

  private snapshot(state: SessionState): SessionSnapshot {
    const currentState = state.steps.length > 0
      ? state.steps[state.steps.length - 1]!.toState
      : state.initialState;
    return {
      sessionId:     state.sessionId,
      entityType:    state.entityType,
      actions:       state.actions,
      cursor:        state.cursor,
      breakpoints:   state.breakpoints,
      status:        state.status,
      steps:         state.steps,
      currentState,
      finalState:    currentState,
      reachedStates: state.reachedStates,
      currentEntity: state.entity,
      nextAction:    state.actions[state.cursor],
    };
  }
}
