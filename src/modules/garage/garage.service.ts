import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { Inject } from '@nestjs/common';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { ownershipWhere, assertOwnership } from '../../common/helpers/scope-filter';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';

export interface CreateMaintenanceDto {
  busId:       string;
  type:        string;
  description: string;
  scheduledAt: string;
  odometer?:   number;
}

@Injectable()
export class GarageService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async createReport(tenantId: string, dto: CreateMaintenanceDto, actor: CurrentUserPayload) {
    const bus = await this.prisma.bus.findFirst({ where: { id: dto.busId, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${dto.busId} not found`);

    return this.prisma.maintenanceReport.create({
      data: {
        tenantId,
        busId:       dto.busId,
        type:        dto.type,
        description: dto.description,
        scheduledAt: new Date(dto.scheduledAt),
        odometer:    dto.odometer,
        createdById: actor.id,
        status:      'SCHEDULED',
      },
    });
  }

  /**
   * Complete — transition `complete` du blueprint MaintenanceReport.
   * Fields `notes`, `completedAt`, `completedById` persistés via persist callback.
   */
  async complete(tenantId: string, reportId: string, notes: string, actor: CurrentUserPayload, scope?: ScopeContext) {
    const report = await this.prisma.maintenanceReport.findFirst({
      where: { id: reportId, tenantId },
    });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    if (scope) assertOwnership(scope, report, 'createdById');

    const result = await this.workflow.transition(
      report as Parameters<typeof this.workflow.transition>[0],
      { action: 'complete', actor },
      {
        aggregateType: 'MaintenanceReport',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.maintenanceReport.update({
            where: { id: entity.id },
            data: {
              status:         toState,
              version:        { increment: 1 },
              completedAt:    new Date(),
              completedById:  actor.id,
              notes,
            },
          });
          return updated as typeof entity;
        },
      },
    );
    return result.entity;
  }

  /**
   * Approve — transition `approve` du blueprint MaintenanceReport, COMPLETED → APPROVED.
   * Side-effect : remise du Bus en service via la transition `RESTORE` de son
   * propre blueprint (bus-cycle). Le Bus doit être en MAINTENANCE — si autre
   * état, on log un warning et on n'essaie pas (évite l'échec bloquant).
   */
  async approve(tenantId: string, reportId: string, actor: CurrentUserPayload) {
    const report = await this.prisma.maintenanceReport.findFirst({
      where: { id: reportId, tenantId },
    });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);

    // 1. Transition MaintenanceReport → APPROVED
    const approved = await this.workflow.transition(
      report as Parameters<typeof this.workflow.transition>[0],
      { action: 'approve', actor },
      {
        aggregateType: 'MaintenanceReport',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.maintenanceReport.update({
            where: { id: entity.id },
            data: {
              status:       toState,
              version:      { increment: 1 },
              approvedById: actor.id,
              approvedAt:   new Date(),
            },
          });
          return updated as typeof entity;
        },
      },
    );

    // 2. Side-effect : RESTORE le bus (MAINTENANCE → AVAILABLE) — respecte
    //    le blueprint bus-cycle au lieu d'un update direct.
    const bus = await this.prisma.bus.findFirst({ where: { id: report.busId, tenantId } });
    if (bus && bus.status === 'MAINTENANCE') {
      try {
        await this.workflow.transition(
          bus as Parameters<typeof this.workflow.transition>[0],
          { action: 'RESTORE', actor },
          {
            aggregateType: 'Bus',
            persist: async (entity, toState, prisma) => {
              const updated = await prisma.bus.update({
                where: { id: entity.id },
                data:  { status: toState, version: { increment: 1 } },
              });
              return updated as typeof entity;
            },
          },
        );
      } catch (err) {
        // Ne bloque pas l'approbation du rapport — le bus pourra être restauré
        // manuellement via FleetService.updateStatus si besoin.
        if (err instanceof BadRequestException) { /* ignored */ }
      }
    }

    return approved.entity;
  }

  async getDocumentUploadUrl(tenantId: string, reportId: string, scope?: ScopeContext) {
    if (scope?.scope === 'own') {
      const report = await this.prisma.maintenanceReport.findFirst({
        where:  { id: reportId, tenantId },
        select: { createdById: true },
      });
      if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
      if (report.createdById !== scope.userId) {
        throw new ForbiddenException(`Scope 'own' violation — report not owned by actor`);
      }
    }
    const key = `${tenantId}/maintenance/${reportId}/${Date.now()}.pdf`;
    return this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);
  }

  async findByBus(tenantId: string, busId: string, scope?: ScopeContext) {
    return this.prisma.maintenanceReport.findMany({
      where: {
        tenantId, busId,
        ...(scope ? ownershipWhere(scope, 'createdById') : {}),
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async findAll(tenantId: string, status?: string, scope?: ScopeContext) {
    return this.prisma.maintenanceReport.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(scope ? ownershipWhere(scope, 'createdById') : {}),
      },
      include: { bus: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }
}
