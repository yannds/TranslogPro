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
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService }          from '../../infrastructure/database/prisma.service';
import { WorkflowGraphAdapter, PrismaWorkflowConfig }   from '../../core/workflow/adapters/workflow-graph.adapter';
import { WorkflowValidator }      from '../../core/workflow/validators/workflow.validator';
import {
  WorkflowGraph,
  SimulationResult,
  SimulationStep,
  HumanSummary,
  StructuredStep,
  StructuredConclusion,
} from '../../core/workflow/types/graph.types';
import { CreateBlueprintDto, UpdateBlueprintDto, WorkflowGraphDto } from './dto/create-blueprint.dto';
import { SimulateWorkflowDto }    from './dto/simulate-workflow.dto';
import { DEFAULT_REGISTRY }       from '../../core/workflow/validators/workflow.validator';
import { WorkflowEngine }         from '../../core/workflow/workflow.engine';
import { SimulationWorkflowIO }   from '../../core/workflow/io/simulation-workflow.io';
import { EntityFactoryRegistry }  from '../../core/workflow/io/entity-factory.registry';
import { GuardDefinition }        from '../../core/workflow/types/guard-definition.type';
import { WorkflowEntity }         from '../../core/workflow/interfaces/workflow-entity.interface';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SuggestedPermission {
  value: string;
  /** Source : 'graph' (utilisée ailleurs dans ce type d'entité), 'convention' (déduite), 'system' (blueprint) */
  source: 'graph' | 'convention' | 'system';
  /** Nombre d'edges qui l'utilisent dans le graphe actif ou les blueprints */
  usedBy?: number;
}

export interface SuggestedRole {
  id:   string;
  name: string;
  /** Nombre d'utilisateurs rattachés à ce rôle (indicateur d'impact). */
  userCount: number;
}

export interface WorkflowSuggestions {
  entityType: string;
  action:     string;
  suggestedPermissions: SuggestedPermission[];
  suggestedRoles:       SuggestedRole[];
}

export interface EntityTypeMetadata {
  entityType:           string;
  /** États présents dans le graphe actif (ou blueprint système si pas encore configuré) */
  states:               string[];
  /** Actions/verbes des transitions */
  actions:              string[];
  /** Permissions référencées dans ce graphe */
  permissions:          string[];
  /** Guards disponibles dans le registre applicatif */
  availableGuards:      string[];
  /** SideEffects disponibles dans le registre applicatif */
  availableSideEffects: string[];
  /** true si le graphe provient du blueprint système (tenant pas encore configuré) */
  fromSystemBlueprint:  boolean;
}

@Injectable()
export class WorkflowStudioService {
  private readonly logger    = new Logger(WorkflowStudioService.name);
  private readonly validator = new WorkflowValidator();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngine,
  ) {}

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

  // ─── Métadonnées contextuelles ──────────────────────────────────────────────

  /**
   * Retourne les métadonnées contextuelles d'un entityType :
   *   - états et actions du graphe actif (ou du blueprint système si non configuré)
   *   - registre complet guards/sideEffects
   *   - permissions déjà utilisées dans ce graphe (suggestions)
   *
   * Sécurité : lecture seule, aucune donnée sensible exposée.
   */
  async getEntityTypeMetadata(
    tenantId:   string,
    entityType: string,
  ): Promise<EntityTypeMetadata> {
    let graph = await this.getTenantGraph(tenantId, entityType);
    let fromSystemBlueprint = false;

    // Fallback vers le blueprint système si le tenant n'a pas encore de config
    if (graph.nodes.length === 0) {
      const systemBp = await this.prisma.workflowBlueprint.findFirst({
        where:   { entityType, isSystem: true },
        orderBy: { usageCount: 'desc' },
      });
      if (systemBp) {
        graph = systemBp.graphJson as unknown as typeof graph;
        fromSystemBlueprint = true;
      }
    }

    const states      = graph.nodes.map(n => n.id);
    const actions     = [...new Set(graph.edges.map(e => e.label))].sort();
    const permissions = [...new Set(graph.edges.map(e => e.permission).filter(Boolean))].sort();

    return {
      entityType,
      states,
      actions,
      permissions,
      availableGuards:      DEFAULT_REGISTRY.guards,
      availableSideEffects: DEFAULT_REGISTRY.sideEffects,
      fromSystemBlueprint,
    };
  }

  // ─── Suggestions (conception) ───────────────────────────────────────────────

  /**
   * Propose à la conception d'une transition :
   *   - des permissions probables (déduites des edges existants + convention)
   *   - des rôles qui possèdent ces permissions (pour cette transition)
   *
   * Source de vérité : les vraies permissions DB du tenant. Le designer
   * conserve la liberté de saisir une autre valeur.
   */
  async getSuggestions(
    tenantId:   string,
    entityType: string,
    action:     string,
  ): Promise<WorkflowSuggestions> {
    const suggestedPermissions: SuggestedPermission[] = [];
    const seen = new Set<string>();

    // ── 1. Permissions déjà utilisées ailleurs dans ce entityType ──────────
    // Lecture depuis les WorkflowConfig actifs du tenant : fréquences réelles.
    const tenantConfigs = await this.prisma.workflowConfig.findMany({
      where:  { tenantId, entityType, isActive: true },
      select: { requiredPerm: true, action: true },
    });
    const freq = new Map<string, number>();
    for (const c of tenantConfigs) {
      if (!c.requiredPerm) continue;
      freq.set(c.requiredPerm, (freq.get(c.requiredPerm) ?? 0) + 1);
    }
    // Bonus : permissions exactes pour ce couple (entityType, action) d'abord
    const sameActionFirst = tenantConfigs
      .filter(c => c.action === action && c.requiredPerm)
      .map(c => c.requiredPerm!);
    for (const p of sameActionFirst) {
      if (seen.has(p)) continue;
      seen.add(p);
      suggestedPermissions.push({ value: p, source: 'graph', usedBy: freq.get(p) ?? 1 });
    }
    // Puis toutes les permissions du type d'entité, triées par fréquence
    const ranked = [...freq.entries()]
      .filter(([p]) => !seen.has(p))
      .sort((a, b) => b[1] - a[1]);
    for (const [p, count] of ranked) {
      seen.add(p);
      suggestedPermissions.push({ value: p, source: 'graph', usedBy: count });
    }

    // ── 2. Convention de nommage : data.<entity>.<action>.<scope> ──────────
    const entityLower = entityType.toLowerCase();
    const actionLower = action.toLowerCase().replace(/\s+/g, '_');
    const scopes = ['agency', 'tenant', 'own', 'global'];
    for (const scope of scopes) {
      const candidate = `data.${entityLower}.${actionLower}.${scope}`;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        suggestedPermissions.push({ value: candidate, source: 'convention' });
      }
    }

    // ── 3. Permissions présentes dans les blueprints système pour ce type ──
    const systemBps = await this.prisma.workflowBlueprint.findMany({
      where:  { entityType, isSystem: true },
      select: { graphJson: true },
    });
    for (const bp of systemBps) {
      const graph = bp.graphJson as unknown as WorkflowGraph;
      for (const e of graph.edges ?? []) {
        if (e.permission && !seen.has(e.permission)) {
          seen.add(e.permission);
          suggestedPermissions.push({ value: e.permission, source: 'system' });
        }
      }
    }

    // ── 4. Rôles compatibles — possédant au moins une des permissions top-3 ──
    const topPerms = suggestedPermissions
      .filter(p => p.source === 'graph' || p.source === 'system')
      .slice(0, 3)
      .map(p => p.value);

    let suggestedRoles: SuggestedRole[] = [];
    if (topPerms.length > 0) {
      const rolesWithPerm = await this.prisma.role.findMany({
        where: {
          tenantId,
          permissions: { some: { permission: { in: topPerms } } },
        },
        select: {
          id:    true,
          name:  true,
          _count: { select: { users: true } },
        },
        orderBy: { name: 'asc' },
      });
      suggestedRoles = rolesWithPerm.map(r => ({
        id:        r.id,
        name:      r.name,
        userCount: r._count.users,
      }));
    }

    return {
      entityType,
      action,
      suggestedPermissions,
      suggestedRoles,
    };
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

    if (!graph?.entityType) {
      throw new BadRequestException(
        `Le blueprint ${blueprintId} n'a pas d'entityType défini dans son graphJson`,
      );
    }

    if (!graph.edges || graph.edges.length === 0) {
      throw new BadRequestException(
        `Le blueprint ${blueprintId} ne contient aucune transition (graphe vide)`,
      );
    }

    try {
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
    } catch (err) {
      // Convertir les erreurs Prisma en réponses HTTP exploitables
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          throw new BadRequestException(
            `Conflit de données lors de l'installation (contrainte unique P2002). ` +
            `Réessayez ou vérifiez les transitions du blueprint.`,
          );
        }
        if (err.code === 'P2003') {
          throw new BadRequestException(
            `Tenant ou ressource inexistant (contrainte FK P2003). ` +
            `Vérifiez que le tenant est correctement initialisé.`,
          );
        }
        throw new InternalServerErrorException(
          `Erreur base de données lors de l'installation [${err.code}]: ${err.message}`,
        );
      }
      // Reraise les HttpExceptions telles quelles
      if (err instanceof Error && 'getStatus' in err) throw err;
      throw new InternalServerErrorException(
        `Erreur inattendue lors de l'installation du blueprint: ${(err as Error).message}`,
      );
    }

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
    // ─── 1. Résoudre le graphe à simuler ───────────────────────────────────
    // Priorité : graph passé par le designer > blueprintId > graphe actif tenant.
    let graph: WorkflowGraph;
    if (dto.graph) {
      graph = this.dtoToGraph(dto.graph);
    } else if (dto.blueprintId) {
      const bp = await this.prisma.workflowBlueprint.findFirst({
        where: { id: dto.blueprintId, OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }] },
      });
      if (!bp) throw new NotFoundException(`Blueprint ${dto.blueprintId} introuvable`);
      graph = bp.graphJson as unknown as WorkflowGraph;
    } else {
      graph = await this.getTenantGraph(tenantId, dto.entityType);
    }

    // ─── 2. Résoudre l'acteur simulé ───────────────────────────────────────
    // Si roleId fourni → fidélité max : vraies permissions DB
    // Sinon → mode "sudo conception" : on ignore les permissions
    let simulatedActor = {
      id:       'sandbox-actor',
      tenantId,
      roleId:   'sandbox-role',
      roleName: 'Simulation',
      agencyId: 'sandbox-agency', // satisfait le scope check dans le moteur
    };
    const ignorePermissions = !dto.simulatedRoleId;

    if (dto.simulatedRoleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: dto.simulatedRoleId },
        select: { id: true, name: true, tenantId: true },
      });
      if (!role) throw new NotFoundException(`Role ${dto.simulatedRoleId} introuvable`);
      if (role.tenantId !== tenantId) {
        throw new BadRequestException(`Role ${dto.simulatedRoleId} n'appartient pas à ce tenant`);
      }
      simulatedActor = {
        id:       `sandbox-user-${role.id}`,
        tenantId,
        roleId:   role.id,
        roleName: role.name,
        agencyId: 'sandbox-agency',
      };
    }

    // ─── 3. Entité sandbox + IO mémoire ────────────────────────────────────
    if (!EntityFactoryRegistry.supports(dto.entityType)) {
      throw new BadRequestException(
        `Pas de factory sandbox pour entityType="${dto.entityType}". ` +
        `Ajoutez-la dans EntityFactoryRegistry.`,
      );
    }
    const sandboxEntity = EntityFactoryRegistry.create({
      entityType:   dto.entityType,
      tenantId,
      initialState: dto.initialState,
      overrides:    dto.context ?? {},
    });

    const io = new SimulationWorkflowIO(this.prisma, graph, ignorePermissions);
    io.setEntity(sandboxEntity);

    // ─── 4. Boucle sur la séquence via le VRAI WorkflowEngine ──────────────
    const steps: SimulationStep[] = [];
    const reachedStates = new Set<string>([dto.initialState]);
    let currentEntity: WorkflowEntity = sandboxEntity;
    let currentState = dto.initialState;
    const ctx = dto.context ?? {};

    // Map fromState|action → edge pour récupérer les metadata UI (guards, edgeId)
    const edgeMap = new Map(graph.edges.map(e => [`${e.source}|${e.label}`, e]));

    for (const action of dto.actions) {
      const edge = edgeMap.get(`${currentState}|${action}`);

      if (!edge) {
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

      // Capture des résultats de guards pendant leur évaluation par le moteur.
      // Les guards lisent les valeurs booléennes du contexte fourni — ce sont
      // les cases cochées dans la UI. Fidélité : même code path que prod.
      const guardResults: Record<string, boolean | null> = {};
      const dynamicGuards: GuardDefinition<WorkflowEntity>[] = edge.guards.map(name => ({
        name,
        fn: async (_entity, _input, guardCtx) => {
          const specified = name in guardCtx;
          const value = specified ? Boolean(guardCtx[name]) : true;
          guardResults[name] = specified ? Boolean(guardCtx[name]) : null;
          return value;
        },
      }));

      // Snapshot des side-effects AVANT la transition pour isoler ceux capturés
      // spécifiquement pendant cette étape.
      const sideEffectsBefore = io.sideEffects.length;

      // Reconstruire un side-effect "proxy" par nom déclaré dans l'arête,
      // qui NE FAIT RIEN (en sim) mais sera capturé avec son nom par l'IO.
      const dynamicSideEffects = edge.sideEffects.map(name => ({
        name,
        fn: async () => { /* no-op — capture-only en sim */ },
      }));

      try {
        const result = await this.engine.transition(
          currentEntity,
          {
            action,
            actor:   simulatedActor,
            context: ctx,
          },
          {
            aggregateType: dto.entityType,
            guards:        dynamicGuards,
            sideEffects:   dynamicSideEffects,
            // persist() n'est JAMAIS appelé en mode sim (SimulationWorkflowTxIO.persist
            // intercepte), mais TypeScript exige la signature.
            persist: async (e, toState) => ({ ...e, status: toState, version: e.version + 1 } as typeof e),
          },
          io,
        );

        const stepSideEffects = io.sideEffects.slice(sideEffectsBefore).map(se => ({
          name:    se.name,
          payload: se.entity,
        }));

        steps.push({
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

        currentEntity = result.entity;
        currentState  = result.toState;
        reachedStates.add(currentState);
      } catch (err) {
        // Toute exception du moteur = étape bloquée. On inspecte le type pour
        // fournir un retour précis (permission vs guard).
        const isForbidden = err instanceof ForbiddenException;
        const errorMessage = (err as Error).message;

        steps.push({
          edgeId:       edge.id,
          action,
          fromState:    currentState,
          toState:      currentState,
          guardResult:  guardResults,
          permGranted:  !isForbidden,
          permission:   edge.permission,
          reachable:    false,
          errorMessage,
          capturedSideEffects: [], // pas de side-effect si la transition échoue
        });
        break;
      }
    }

    const allStates = new Set(graph.nodes.map(n => n.id));
    const unreachableStates = Array.from(allStates).filter(s => !reachedStates.has(s));

    const result: SimulationResult = {
      entityType:        dto.entityType,
      initialState:      dto.initialState,
      finalState:        currentState,
      steps,
      reachedStates:     Array.from(reachedStates),
      unreachableStates,
      finalEntity:       { ...currentEntity } as Record<string, unknown>,
    };
    result.humanSummary = await this.buildHumanSummary(tenantId, result, dto.simulatedRoleId);
    return result;
  }

  // ─── Exploration automatique (BFS) ──────────────────────────────────────────

  /**
   * Explore tout le graphe depuis l'état initial avec le rôle simulé.
   *
   * Pour chaque état atteint, tente CHAQUE action sortante via le vrai engine.
   * Marque les transitions qui passent (✓), celles qui sont bloquées (permission,
   * guard, etc.) avec leur raison. Évite les cycles via Set<state>.
   *
   * Limite de profondeur : 30 transitions tentées (garde-fou anti-explosion).
   *
   * Réutilise le format SimulationResult — chaque "step" est une tentative
   * de transition (success ou échec) → la UI peut tout afficher en timeline.
   */
  async exploreWorkflow(
    tenantId: string,
    dto:      SimulateWorkflowDto,
  ): Promise<SimulationResult> {
    // Résoudre le graphe (même priorité que simulateWorkflow)
    let graph: WorkflowGraph;
    if (dto.graph) {
      graph = this.dtoToGraph(dto.graph);
    } else if (dto.blueprintId) {
      const bp = await this.prisma.workflowBlueprint.findFirst({
        where: { id: dto.blueprintId, OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }] },
      });
      if (!bp) throw new NotFoundException(`Blueprint ${dto.blueprintId} introuvable`);
      graph = bp.graphJson as unknown as WorkflowGraph;
    } else {
      graph = await this.getTenantGraph(tenantId, dto.entityType);
    }

    // Acteur simulé
    let simulatedActor = {
      id:       'sandbox-actor',
      tenantId,
      roleId:   'sandbox-role',
      roleName: 'Simulation',
      agencyId: 'sandbox-agency',
    };
    const ignorePermissions = !dto.simulatedRoleId;
    if (dto.simulatedRoleId) {
      const role = await this.prisma.role.findUnique({
        where: { id: dto.simulatedRoleId },
        select: { id: true, name: true, tenantId: true },
      });
      if (!role) throw new NotFoundException(`Role ${dto.simulatedRoleId} introuvable`);
      if (role.tenantId !== tenantId) {
        throw new BadRequestException(`Role ${dto.simulatedRoleId} n'appartient pas à ce tenant`);
      }
      simulatedActor = {
        id:       `sandbox-user-${role.id}`,
        tenantId,
        roleId:   role.id,
        roleName: role.name,
        agencyId: 'sandbox-agency',
      };
    }

    if (!EntityFactoryRegistry.supports(dto.entityType)) {
      throw new BadRequestException(
        `Pas de factory sandbox pour entityType="${dto.entityType}"`,
      );
    }

    // ─── BFS ────────────────────────────────────────────────────────────────
    // Queue d'états à visiter, chacun avec sa propre entité sandbox (snapshot).
    type QueueItem = { state: string; entity: WorkflowEntity };
    const initialEntity = EntityFactoryRegistry.create({
      entityType:   dto.entityType,
      tenantId,
      initialState: dto.initialState,
      overrides:    dto.context ?? {},
    });
    const queue: QueueItem[] = [{ state: dto.initialState, entity: initialEntity }];
    const visited = new Set<string>([dto.initialState]);
    const reachedStates = new Set<string>([dto.initialState]);
    const steps: SimulationStep[] = [];
    const ctx = dto.context ?? {};

    const MAX_TRANSITIONS = 30;

    while (queue.length > 0 && steps.length < MAX_TRANSITIONS) {
      const { state, entity } = queue.shift()!;

      // Toutes les transitions sortantes depuis cet état
      const outgoing = graph.edges.filter(e => e.source === state);

      for (const edge of outgoing) {
        if (steps.length >= MAX_TRANSITIONS) break;

        // Nouvel IO + entité fraîche par tentative — pas de pollution croisée
        const io = new SimulationWorkflowIO(this.prisma, graph, ignorePermissions);
        const tryEntity = { ...entity, status: state } as WorkflowEntity;
        io.setEntity(tryEntity);

        const guardResults: Record<string, boolean | null> = {};
        const dynamicGuards: GuardDefinition<WorkflowEntity>[] = edge.guards.map(name => ({
          name,
          fn: async (_e, _i, gctx) => {
            const specified = name in gctx;
            const value = specified ? Boolean(gctx[name]) : true;
            guardResults[name] = specified ? Boolean(gctx[name]) : null;
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
            tryEntity,
            { action: edge.label, actor: simulatedActor, context: ctx },
            {
              aggregateType: dto.entityType,
              guards:        dynamicGuards,
              sideEffects:   dynamicSideEffects,
              persist: async (e, toState) => ({ ...e, status: toState, version: e.version + 1 } as typeof e),
            },
            io,
          );

          steps.push({
            edgeId:      edge.id,
            action:      edge.label,
            fromState:   state,
            toState:     result.toState,
            guardResult: guardResults,
            permGranted: true,
            permission:  edge.permission,
            reachable:   true,
            capturedSideEffects: io.sideEffects.slice(sideEffectsBefore).map(se => ({
              name:    se.name,
              payload: se.entity,
            })),
          });

          reachedStates.add(result.toState);

          // Enfile l'état nouvellement atteint pour explorer ses sorties (anti-cycle)
          if (!visited.has(result.toState)) {
            visited.add(result.toState);
            queue.push({ state: result.toState, entity: result.entity });
          }
        } catch (err) {
          const isForbidden = err instanceof ForbiddenException;
          steps.push({
            edgeId:       edge.id,
            action:       edge.label,
            fromState:    state,
            toState:      state,
            guardResult:  guardResults,
            permGranted:  !isForbidden,
            permission:   edge.permission,
            reachable:    false,
            errorMessage: (err as Error).message,
            capturedSideEffects: [],
          });
          // On continue l'exploration des autres sorties — un échec ne stoppe pas le BFS
        }
      }
    }

    const allStates = new Set(graph.nodes.map(n => n.id));
    const unreachableStates = Array.from(allStates).filter(s => !reachedStates.has(s));

    // L'état "final" en mode exploration n'a pas vraiment de sens — on prend
    // le dernier toState atteint avec succès, sinon l'initial.
    const lastSuccess = [...steps].reverse().find(s => s.reachable);
    const finalState = lastSuccess?.toState ?? dto.initialState;

    const result: SimulationResult = {
      entityType:        dto.entityType,
      initialState:      dto.initialState,
      finalState,
      steps,
      reachedStates:     Array.from(reachedStates),
      unreachableStates,
    };
    result.humanSummary = await this.buildHumanSummary(tenantId, result, dto.simulatedRoleId);
    return result;
  }

  // ─── Résumé en langage humain ──────────────────────────────────────────────

  /**
   * Construit une interprétation lisible des résultats de simulation.
   * Pensé pour les utilisateurs métiers (pas d'identifiants techniques bruts).
   *
   * Charge d'un coup les rôles qui possèdent les permissions bloquantes
   * pour proposer des alternatives concrètes.
   */
  private async buildHumanSummary(
    tenantId:        string,
    result:          SimulationResult,
    simulatedRoleId: string | undefined,
  ): Promise<HumanSummary> {
    const roleName = simulatedRoleId
      ? (await this.prisma.role.findUnique({
          where: { id: simulatedRoleId }, select: { name: true },
        }))?.name ?? ''
      : '';

    // Permissions des transitions bloquées par "permission refusée"
    const blockedPerms = new Set<string>();
    for (const step of result.steps) {
      if (!step.reachable && !step.permGranted && step.permission) {
        blockedPerms.add(step.permission);
      }
    }

    // Lookup unique des rôles qui possèdent ces permissions
    const permToRoles = new Map<string, string[]>();
    if (blockedPerms.size > 0) {
      const rows = await this.prisma.rolePermission.findMany({
        where:   { permission: { in: [...blockedPerms] }, role: { tenantId } },
        select:  { permission: true, role: { select: { name: true } } },
      });
      for (const r of rows) {
        const list = permToRoles.get(r.permission) ?? [];
        list.push(r.role.name);
        permToRoles.set(r.permission, list);
      }
    }

    const rolesFor = (perm: string): string[] =>
      [...new Set(permToRoles.get(perm) ?? [])].sort();

    // Étapes structurées — zéro prose, le frontend compose les phrases dans sa langue
    const perStep: StructuredStep[] = result.steps.map(step => {
      const base = {
        action:    step.action,
        fromState: step.fromState,
        toState:   step.toState,
      };
      if (step.reachable) {
        return { ...base, reason: 'success' as const };
      }
      if (!step.permGranted && step.permission) {
        return {
          ...base,
          reason:              'permission_denied' as const,
          missingPermission:   step.permission,
          rolesWithPermission: rolesFor(step.permission),
        };
      }
      const failedGuard = Object.entries(step.guardResult).find(([, v]) => v === false);
      if (failedGuard) {
        return { ...base, reason: 'guard_blocked' as const, guardName: failedGuard[0] };
      }
      return { ...base, reason: 'transition_unknown' as const, errorMessage: step.errorMessage };
    });

    const successCount = result.steps.filter(s => s.reachable).length;
    const total        = result.steps.length;

    // Conclusion structurée
    let conclusion: StructuredConclusion | undefined;
    if (blockedPerms.size > 0) {
      const allOwners = new Set<string>();
      for (const p of blockedPerms) rolesFor(p).forEach(r => allOwners.add(r));

      if (allOwners.size === 0) {
        conclusion = {
          type:               'no_permission_owner',
          missingPermissions: [...blockedPerms].sort(),
        };
      } else {
        conclusion = {
          type:           'try_other_roles',
          rolesSuggested: [...allOwners].sort(),
        };
      }
    } else if (result.unreachableStates.length > 0 && successCount > 0) {
      conclusion = {
        type:              'states_unreachable',
        unreachableStates: result.unreachableStates,
      };
    } else if (successCount === total && total > 0) {
      conclusion = { type: 'all_success' };
    }

    return {
      roleName,
      ignoredPermissions: !simulatedRoleId,
      totalCount:         total,
      successCount,
      perStep,
      conclusion,
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

}
