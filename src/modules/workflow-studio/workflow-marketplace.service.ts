/**
 * WorkflowMarketplaceService
 *
 * Marketplace de blueprints de workflow :
 *   - Publier un blueprint (PUBLIC ou PRIVATE)
 *   - Parcourir la marketplace (PUBLIC + système)
 *   - Exporter un blueprint en JSON signé (checksum SHA-256)
 *   - Importer un blueprint depuis JSON (vérification intégrité + re-validation)
 *   - onTenantCreated() : injecte automatiquement le blueprint "Standard" par défaut
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService }       from '../../infrastructure/database/prisma.service';
import { WorkflowGraphAdapter } from '../../core/workflow/adapters/workflow-graph.adapter';
import { WorkflowValidator }   from '../../core/workflow/validators/workflow.validator';
import { WorkflowGraph }       from '../../core/workflow/types/graph.types';
import { ImportBlueprintDto }  from './dto/create-blueprint.dto';

@Injectable()
export class WorkflowMarketplaceService {
  private readonly logger    = new Logger(WorkflowMarketplaceService.name);
  private readonly validator = new WorkflowValidator();

  constructor(private readonly prisma: PrismaService) {}

  // ─── Marketplace browser ───────────────────────────────────────────────────

  /** Parcourir la marketplace : blueprints publics + système, triés par usageCount. */
  async browseMarketplace(filter?: {
    entityType?: string;
    categoryId?: string;
    search?:     string;
  }) {
    return this.prisma.workflowBlueprint.findMany({
      where: {
        isPublic: true,
        ...(filter?.entityType ? { entityType: filter.entityType } : {}),
        ...(filter?.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter?.search ? {
          OR: [
            { name: { contains: filter.search, mode: 'insensitive' } },
            { description: { contains: filter.search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      include: {
        category: true,
        _count:   { select: { installs: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { usageCount: 'desc' }, { name: 'asc' }],
    });
  }

  async listCategories() {
    return this.prisma.blueprintCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  // ─── Publish / Unpublish ───────────────────────────────────────────────────

  /**
   * Publie un blueprint du tenant sur la marketplace (isPublic = true).
   * Seul le propriétaire peut publier ses blueprints.
   */
  async publish(blueprintId: string, tenantId: string, actorId: string) {
    const bp = await this.findOwnedBlueprint(blueprintId, tenantId);
    if (bp.isSystem) throw new ForbiddenException('Les blueprints système sont publiés par défaut');

    const updated = await this.prisma.workflowBlueprint.update({
      where: { id: blueprintId },
      data:  { isPublic: true },
    });

    this.logger.log(`Blueprint ${blueprintId} publié sur la marketplace par tenant=${tenantId}`);
    return updated;
  }

  async unpublish(blueprintId: string, tenantId: string, actorId: string) {
    const bp = await this.findOwnedBlueprint(blueprintId, tenantId);
    if (bp.isSystem) throw new ForbiddenException('Les blueprints système ne peuvent pas être retirés');

    return this.prisma.workflowBlueprint.update({
      where: { id: blueprintId },
      data:  { isPublic: false },
    });
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  /**
   * Exporte un blueprint en JSON signé.
   * Le checksum est recalculé à l'export pour garantir sa fraîcheur.
   */
  async exportBlueprint(blueprintId: string, tenantId: string): Promise<{
    payload:  WorkflowGraph;
    checksum: string;
    meta:     Record<string, unknown>;
  }> {
    const bp = await this.prisma.workflowBlueprint.findFirst({
      where: {
        id: blueprintId,
        OR: [{ isPublic: true }, { isSystem: true }, { authorTenantId: tenantId }],
      },
      include: { category: true },
    });
    if (!bp) throw new NotFoundException(`Blueprint ${blueprintId} introuvable`);

    const graph = bp.graphJson as unknown as WorkflowGraph;
    // Recalcul checksum
    const checksum = WorkflowGraphAdapter.computeChecksum(graph);

    return {
      payload: { ...graph, checksum },
      checksum,
      meta: {
        exportedAt:    new Date().toISOString(),
        blueprintName: bp.name,
        version:       bp.version,
        entityType:    bp.entityType,
        authorTenantId: bp.authorTenantId,
        category:      bp.category?.name,
        tags:          bp.tags,
        usageCount:    bp.usageCount,
      },
    };
  }

  // ─── Import ────────────────────────────────────────────────────────────────

  /**
   * Importe un blueprint depuis un JSON exporté.
   *
   * Sécurité :
   *   1. Vérification checksum (intégrité)
   *   2. Re-validation du graphe
   *   3. Création du blueprint pour le tenant importeur (authorTenantId = tenantId)
   *
   * Note : le blueprint importé est PRIVATE par défaut.
   * Le tenant doit explicitement le publier via /publish.
   */
  async importBlueprint(
    tenantId: string,
    dto:      ImportBlueprintDto,
    actorId:  string,
  ) {
    const graph = dto.graphJson as unknown as WorkflowGraph;

    // 1. Vérification checksum
    if (dto.checksum && graph.checksum) {
      const expected = WorkflowGraphAdapter.computeChecksum({ ...graph, checksum: '' });
      if (expected !== dto.checksum || expected !== graph.checksum) {
        throw new BadRequestException(
          `Checksum invalide — blueprint potentiellement altéré (attendu=${expected}, reçu=${dto.checksum})`,
        );
      }
    }

    // 2. Validation graphe
    const validation = this.validator.validate(graph);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Le blueprint importé contient des erreurs de validation',
        errors:  validation.errors,
      });
    }

    // 3. Slug unique pour ce tenant
    const baseSlug = graph.entityType.toLowerCase() + '-imported-' + Date.now();

    const created = await this.prisma.workflowBlueprint.create({
      data: {
        name:           dto.name ?? `[Importé] ${graph.entityType}`,
        slug:           baseSlug,
        description:    dto.description,
        entityType:     graph.entityType,
        graphJson:      graph as any,
        checksum:       graph.checksum || dto.checksum,
        isPublic:       dto.isPublic ?? false,
        authorTenantId: tenantId,
        tags:           [],
        version:        graph.version ?? '1.0.0',
      },
    });

    this.logger.log(`Blueprint importé par tenant=${tenantId}, id=${created.id}`);
    return created;
  }

  // ─── Hook onTenantCreated ──────────────────────────────────────────────────

  /**
   * Injecte automatiquement le blueprint "Standard Ticket" lors de la création
   * d'un nouveau tenant. Appelé par TenantService.create().
   *
   * Si le blueprint système "ticket-standard" n'existe pas en DB (pas encore
   * seedé), la méthode log un warning et ne bloque pas l'onboarding.
   */
  async onTenantCreated(tenantId: string, adminUserId: string): Promise<void> {
    const defaultSlugs = ['ticket-standard', 'parcel-standard'];

    for (const slug of defaultSlugs) {
      const bp = await this.prisma.workflowBlueprint.findFirst({
        where: { slug, isSystem: true },
      });

      if (!bp) {
        this.logger.warn(`Blueprint système "${slug}" non trouvé — seed manquant ?`);
        continue;
      }

      try {
        const graph = bp.graphJson as unknown as WorkflowGraph;

        await this.prisma.transact(async (tx) => {
          const txPrisma = tx as unknown as PrismaService;

          const inputs = WorkflowGraphAdapter.toPrismaCreateInputs(graph, tenantId);
          for (const input of inputs) {
            // Ignorer les conflits si les configs existent déjà
            await txPrisma.workflowConfig.upsert({
              where: {
                tenantId_entityType_fromState_action_version: {
                  tenantId,
                  entityType: (input as any).entityType,
                  fromState:  (input as any).fromState,
                  action:     (input as any).action,
                  version:    1,
                },
              },
              create: input as any,
              update: { isActive: true, requiredPerm: (input as any).requiredPerm },
            });
          }

          await txPrisma.blueprintInstall.upsert({
            where:  { tenantId_blueprintId: { tenantId, blueprintId: bp.id } },
            create: {
              tenantId,
              blueprintId: bp.id,
              snapshotJson: graph as any,
              isDirty:      false,
              installedBy:  adminUserId,
            },
            update: { installedAt: new Date() },
          });
        });

        this.logger.log(`Blueprint "${slug}" auto-installé pour nouveau tenant=${tenantId}`);
      } catch (err) {
        this.logger.error(`Échec auto-install blueprint "${slug}" pour tenant=${tenantId}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Privé ──────────────────────────────────────────────────────────────────

  private async findOwnedBlueprint(blueprintId: string, tenantId: string) {
    const bp = await this.prisma.workflowBlueprint.findFirst({
      where: { id: blueprintId, authorTenantId: tenantId },
    });
    if (!bp) throw new NotFoundException(`Blueprint ${blueprintId} introuvable ou non possédé par ce tenant`);
    return bp;
  }
}
