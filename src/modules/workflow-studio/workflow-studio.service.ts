/**
 * WorkflowStudioService
 *
 * CRUD complet des blueprints de workflow + simulation Live-Path.
 *
 * Fonctionnalités :
 *   - Lire le graphe actif d'un tenant (WorkflowConfig[] → WorkflowGraph)
 *   - Créer/Modifier un blueprint (version immutable)
 *   - Installer un blueprint sur un tenant (reset des WorkflowConfig)
 *   - Simuler un chemin (Live-Path : green/red transitions)
 *   - resetToBlueprint : restaurer le workflow d'un tenant à un blueprint installé
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService }          from '../../infrastructure/database/prisma.service';
import { WorkflowGraphAdapter, PrismaWorkflowConfig }   from '../../core/workflow/adapters/workflow-graph.adapter';
import { WorkflowValidator }      from '../../core/workflow/validators/workflow.validator';
import { WorkflowGraph, SimulationResult, SimulationStep } from '../../core/workflow/types/graph.types';
import { CreateBlueprintDto, UpdateBlueprintDto, WorkflowGraphDto } from './dto/create-blueprint.dto';
import { SimulateWorkflowDto }    from './dto/simulate-workflow.dto';

@Injectable()
export class WorkflowStudioService {
  private readonly logger    = new Logger(WorkflowStudioService.name);
  private readonly validator = new WorkflowValidator();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Graphe actif du tenant ─────────────────────────────────────────────────

  /** Récupère le graphe actif du tenant pour un entityType. */
  async getTenantGraph(tenantId: string, entityType: string): Promise<WorkflowGraph> {
    const configs = await this.prisma.workflowConfig.findMany({
      where: { tenantId, entityType, isActive: true },
    });
    return WorkflowGraphAdapter.fromPrisma(configs as unknown as PrismaWorkflowConfig[], entityType);
  }

  /** Liste tous les entityTypes configurés pour un tenant. */
  async listEntityTypes(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.workflowConfig.findMany({
      where:   { tenantId, isActive: true },
      select:  { entityType: true },
      distinct: ['entityType'],
    });
    return rows.map(r => r.entityType);
  }

  /**
   * Sauvegarde un graphe édité dans le designer comme nouvelles WorkflowConfig.
   * Désactive les configs existantes pour cet entityType avant de créer les nouvelles.
   */
  async saveTenantGraph(
    tenantId: string,
    graphDto: WorkflowGraphDto,
    actorId:  string,
  ): Promise<WorkflowGraph> {
    const graph = this.dtoToGraph(graphDto);
    const validation = this.validator.validate(graph);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Graphe de workflow invalide',
        errors:  validation.errors,
      });
    }

    await this.prisma.transact(async (tx) => {
      const txPrisma = tx as unknown as PrismaService;

      // Désactiver les configs existantes
      await txPrisma.workflowConfig.updateMany({
        where: { tenantId, entityType: graph.entityType, isActive: true },
        data:  { isActive: false },
      });

      // Résoudre le prochain numéro de version pour éviter la violation de contrainte unique
      // @@unique([tenantId, entityType, fromState, action, version]) — version=1 déjà pris
      const versionAgg = await txPrisma.workflowConfig.aggregate({
        where: { tenantId, entityType: graph.entityType },
        _max:  { version: true },
      });
      const nextVersion = (versionAgg._max.version ?? 0) + 1;

      // Créer les nouvelles configs
      const inputs = WorkflowGraphAdapter.toPrismaCreateInputs(graph, tenantId);
      for (const input of inputs) {
        await txPrisma.workflowConfig.create({ data: { ...input, version: nextVersion } as any });
      }
    });

    this.logger.log(`Graphe ${graph.entityType} sauvegardé pour tenant=${tenantId} par actorId=${actorId}`);
    return this.getTenantGraph(tenantId, graph.entityType);
  }

  // ─── CRUD Blueprints ────────────────────────────────────────────────────────

  async createBlueprint(
    tenantId: string,
    dto:      CreateBlueprintDto,
    actorId:  string,
  ) {
    const graph = this.dtoToGraph(dto.graph);
    const validation = this.validator.validate(graph);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Graphe de blueprint invalide',
        errors:  validation.errors,
      });
    }

    graph.checksum = WorkflowGraphAdapter.computeChecksum(graph);

    // Vérifier slug unique pour ce tenant
    const existing = await this.prisma.workflowBlueprint.findFirst({
      where: { authorTenantId: tenantId, slug: dto.slug },
    });
    if (existing) {
      throw new BadRequestException(`Blueprint avec le slug "${dto.slug}" existe déjà pour ce tenant`);
    }

    return this.prisma.workflowBlueprint.create({
      data: {
        name:           dto.name,
        slug:           dto.slug,
        description:    dto.description,
        entityType:     dto.graph.entityType,
        graphJson:      graph as any,
        checksum:       graph.checksum,
        isPublic:       dto.isPublic ?? false,
        authorTenantId: tenantId,
        categoryId:     dto.categoryId,
        tags:           dto.tags ?? [],
        version:        '1.0.0',
      },
      include: { category: true },
    });
  }

  async updateBlueprint(
    blueprintId: string,
    tenantId:    string,
    dto:         UpdateBlueprintDto,
    actorId:     string,
  ) {
    const bp = await this.findOwnedBlueprint(blueprintId, tenantId);

    let graphJson = bp.graphJson;
    let checksum  = bp.checksum;

    if (dto.graph) {
      const graph = this.dtoToGraph(dto.graph);
      const validation = this.validator.validate(graph);
      if (!validation.valid) {
        throw new BadRequestException({ message: 'Graphe invalide', errors: validation.errors });
      }
      graph.checksum = WorkflowGraphAdapter.computeChecksum(graph);
      graphJson  = graph as any;
      checksum   = graph.checksum;
    }

    return this.prisma.workflowBlueprint.update({
      where: { id: blueprintId },
      data:  {
        name:        dto.name        ?? bp.name,
        description: dto.description ?? bp.description,
        isPublic:    dto.isPublic    ?? bp.isPublic,
        categoryId:  dto.categoryId  ?? bp.categoryId,
        tags:        (dto.tags ?? bp.tags) as any,
        graphJson:   graphJson as any,
        checksum,
      },
      include: { category: true },
    });
  }

  async deleteBlueprint(blueprintId: string, tenantId: string): Promise<void> {
    const bp = await this.findOwnedBlueprint(blueprintId, tenantId);
    if (bp.isSystem) {
      throw new ForbiddenException('Les blueprints système ne peuvent pas être supprimés');
    }
    await this.prisma.workflowBlueprint.delete({ where: { id: blueprintId } });
  }

  async getBlueprint(blueprintId: string, tenantId: string) {
    const bp = await this.prisma.workflowBlueprint.findFirst({
      where: {
        id: blueprintId,
        OR: [
          { isPublic: true },
          { isSystem: true },
          { authorTenantId: tenantId },
        ],
      },
      include: { category: true, installs: { where: { tenantId }, take: 1 } },
    });
    if (!bp) throw new NotFoundException(`Blueprint ${blueprintId} introuvable`);
    return bp;
  }

  async listBlueprints(tenantId: string, entityType?: string) {
    return this.prisma.workflowBlueprint.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        OR: [
          { isPublic: true },
          { isSystem: true },
          { authorTenantId: tenantId },
        ],
      },
      include: {
        category: true,
        installs: { where: { tenantId }, take: 1 },
        _count:   { select: { installs: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { usageCount: 'desc' }, { name: 'asc' }],
    });
  }

  // ─── Installation ──────────────────────────────────────────────────────────

  /**
   * Installe un blueprint sur un tenant :
   * 1. Snapshot le graphJson
   * 2. Désactive les WorkflowConfig existantes pour cet entityType
   * 3. Crée les nouvelles WorkflowConfig depuis le graphe
   * 4. Enregistre BlueprintInstall
   */
  async installBlueprint(
    blueprintId: string,
    tenantId:    string,
    actorId:     string,
  ) {
    const bp = await this.prisma.workflowBlueprint.findFirst({
      where: {
        id: blueprintId,
        OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }],
      },
    });
    if (!bp) throw new NotFoundException(`Blueprint ${blueprintId} introuvable ou non accessible`);

    const graph = bp.graphJson as unknown as WorkflowGraph;

    await this.prisma.transact(async (tx) => {
      const txPrisma = tx as unknown as PrismaService;

      // Désactiver les configs existantes
      await txPrisma.workflowConfig.updateMany({
        where: { tenantId, entityType: graph.entityType, isActive: true },
        data:  { isActive: false },
      });

      // Résoudre le prochain numéro de version
      const versionAgg = await txPrisma.workflowConfig.aggregate({
        where: { tenantId, entityType: graph.entityType },
        _max:  { version: true },
      });
      const nextVersion = (versionAgg._max.version ?? 0) + 1;

      // Créer les nouvelles configs depuis le graphe
      const inputs = WorkflowGraphAdapter.toPrismaCreateInputs(graph, tenantId);
      for (const input of inputs) {
        await txPrisma.workflowConfig.create({ data: { ...input, version: nextVersion } as any });
      }

      // Upsert BlueprintInstall
      await txPrisma.blueprintInstall.upsert({
        where:  { tenantId_blueprintId: { tenantId, blueprintId } },
        create: {
          tenantId,
          blueprintId,
          snapshotJson: graph as any,
          isDirty:      false,
          installedBy:  actorId,
        },
        update: {
          snapshotJson: graph as any,
          isDirty:      false,
          installedBy:  actorId,
          installedAt:  new Date(),
        },
      });

      // Incrémenter le compteur d'utilisation
      await txPrisma.workflowBlueprint.update({
        where: { id: blueprintId },
        data:  { usageCount: { increment: 1 } },
      });
    });

    this.logger.log(`Blueprint ${blueprintId} installé sur tenant=${tenantId} par actorId=${actorId}`);
    return this.getTenantGraph(tenantId, graph.entityType);
  }

  /**
   * Réinitialise le workflow du tenant au snapshot du blueprint installé.
   * Utile quand le tenant a fait des customisations et veut revenir au point de départ.
   */
  async resetToBlueprint(
    tenantId:    string,
    entityType:  string,
    actorId:     string,
  ): Promise<WorkflowGraph> {
    const install = await this.prisma.blueprintInstall.findFirst({
      where:   { tenantId },
      include: { blueprint: { select: { entityType: true } } },
      orderBy: { installedAt: 'desc' },
    });

    if (!install) {
      throw new NotFoundException(`Aucun blueprint installé pour tenant=${tenantId}`);
    }

    const snapshot = install.snapshotJson as unknown as WorkflowGraph;
    if (snapshot.entityType !== entityType) {
      throw new BadRequestException(
        `Le dernier blueprint installé est pour entityType="${snapshot.entityType}", pas "${entityType}"`,
      );
    }

    await this.prisma.transact(async (tx) => {
      const txPrisma = tx as unknown as PrismaService;
      await txPrisma.workflowConfig.updateMany({
        where: { tenantId, entityType, isActive: true },
        data:  { isActive: false },
      });
      const versionAgg = await txPrisma.workflowConfig.aggregate({
        where: { tenantId, entityType },
        _max:  { version: true },
      });
      const nextVersion = (versionAgg._max.version ?? 0) + 1;

      const inputs = WorkflowGraphAdapter.toPrismaCreateInputs(snapshot, tenantId);
      for (const input of inputs) {
        await txPrisma.workflowConfig.create({ data: { ...input, version: nextVersion } as any });
      }
      await txPrisma.blueprintInstall.update({
        where: { id: install.id },
        data:  { isDirty: false },
      });
    });

    this.logger.log(`Workflow ${entityType} réinitialisé au blueprint pour tenant=${tenantId} par actorId=${actorId}`);
    return this.getTenantGraph(tenantId, entityType);
  }

  // ─── Simulation Live-Path ──────────────────────────────────────────────────

  /**
   * Simule un chemin de transitions sans toucher à la DB.
   *
   * Pour chaque action :
   *   1. Trouve l'arête (fromState, action)
   *   2. Vérifie la permission du rôle simulé
   *   3. Évalue les guards avec le contexte fourni
   *   4. Marque l'étape comme reachable=true ou false (bloquée)
   *   5. Si bloquée, arrête la simulation
   */
  async simulateWorkflow(
    tenantId: string,
    dto:      SimulateWorkflowDto,
  ): Promise<SimulationResult> {
    let graph: WorkflowGraph;

    if (dto.blueprintId) {
      const bp = await this.prisma.workflowBlueprint.findFirst({
        where: { id: dto.blueprintId, OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }] },
      });
      if (!bp) throw new NotFoundException(`Blueprint ${dto.blueprintId} introuvable`);
      graph = bp.graphJson as unknown as WorkflowGraph;
    } else {
      graph = await this.getTenantGraph(tenantId, dto.entityType);
    }

    // Construire la map edges : "fromState|action" → edge
    const edgeMap = new Map(graph.edges.map(e => [`${e.source}|${e.label}`, e]));

    // Charger les permissions du rôle simulé (si fourni)
    let rolePermissions: Set<string> = new Set();
    if (dto.simulatedRoleId) {
      const rps = await this.prisma.rolePermission.findMany({
        where: { roleId: dto.simulatedRoleId },
      });
      rolePermissions = new Set(rps.map(rp => rp.permission));
    }

    const steps: SimulationStep[] = [];
    const reachedStates = new Set<string>([dto.initialState]);
    let currentState = dto.initialState;

    for (const action of dto.actions) {
      const edge = edgeMap.get(`${currentState}|${action}`);

      if (!edge) {
        // Transition inconnue depuis cet état
        steps.push({
          edgeId:      `${currentState}|${action}`,
          action,
          fromState:   currentState,
          toState:     currentState,
          guardResult: {},
          permGranted: false,
          reachable:   false,
        });
        break;
      }

      const permGranted = !dto.simulatedRoleId || rolePermissions.has(edge.permission);

      // Évaluation des guards avec les valeurs de contexte
      const guardResult: Record<string, boolean | null> = {};
      for (const guard of edge.guards) {
        guardResult[guard] = this.evaluateGuardSimulation(guard, dto.context ?? {});
      }

      const allGuardsPassed = Object.values(guardResult).every(r => r !== false);
      const reachable = permGranted && allGuardsPassed;

      steps.push({
        edgeId:    edge.id,
        action,
        fromState: currentState,
        toState:   edge.target,
        guardResult,
        permGranted,
        reachable,
      });

      if (!reachable) break;

      currentState = edge.target;
      reachedStates.add(currentState);
    }

    const allStates = new Set(graph.nodes.map(n => n.id));
    const unreachableStates = Array.from(allStates).filter(s => !reachedStates.has(s));

    return {
      entityType:        dto.entityType,
      initialState:      dto.initialState,
      finalState:        currentState,
      steps,
      reachedStates:     Array.from(reachedStates),
      unreachableStates,
    };
  }

  // ─── Privé ──────────────────────────────────────────────────────────────────

  private async findOwnedBlueprint(blueprintId: string, tenantId: string) {
    const bp = await this.prisma.workflowBlueprint.findFirst({
      where: { id: blueprintId, authorTenantId: tenantId },
    });
    if (!bp) throw new NotFoundException(`Blueprint ${blueprintId} introuvable ou non possédé par ce tenant`);
    return bp;
  }

  private dtoToGraph(dto: WorkflowGraphDto): WorkflowGraph {
    return {
      entityType: dto.entityType,
      nodes: dto.nodes.map(n => ({
        id:       n.id,
        label:    n.label,
        type:     n.type,
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
        metadata: n.metadata ?? {},
      })),
      edges: dto.edges.map(e => ({
        id:          e.id,
        source:      e.source,
        target:      e.target,
        label:       e.label,
        guards:      e.guards,
        permission:  e.permission,
        sideEffects: e.sideEffects,
        metadata:    e.metadata ?? {},
      })),
      version:  dto.version ?? '1.0.0',
      checksum: '',
      metadata: dto.metadata ?? {},
    };
  }

  /**
   * Évaluation heuristique des guards pour la simulation.
   * Si le contexte contient une valeur pour le guard, on l'utilise.
   * Sinon, on retourne null (non évalué = indéterminé).
   */
  private evaluateGuardSimulation(
    guardName: string,
    context:   Record<string, unknown>,
  ): boolean | null {
    // Convention : le contexte peut contenir le nom du guard → boolean
    if (guardName in context) return Boolean(context[guardName]);

    // Évaluations heuristiques connues
    switch (guardName) {
      case 'checkSoldeAgent':
        if ('balance' in context) return Number(context['balance']) > 0;
        return null;
      case 'checkTicketNotScanned':
        if ('scanned' in context) return !context['scanned'];
        return null;
      case 'checkParcelNotDelivered':
        if ('delivered' in context) return !context['delivered'];
        return null;
      case 'checkPaymentConfirmed':
        if ('paymentConfirmed' in context) return Boolean(context['paymentConfirmed']);
        return null;
      case 'checkCapacityAvailable':
        if ('availableSeats' in context) return Number(context['availableSeats']) > 0;
        return null;
      default:
        return null; // indéterminé
    }
  }
}
