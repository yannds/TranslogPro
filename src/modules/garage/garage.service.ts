import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { Inject } from '@nestjs/common';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { ownershipWhere, assertOwnership } from '../../common/helpers/scope-filter';

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

  async complete(tenantId: string, reportId: string, notes: string, actor: CurrentUserPayload, scope?: ScopeContext) {
    const report = await this.prisma.maintenanceReport.findFirst({
      where: { id: reportId, tenantId },
    });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    if (scope) assertOwnership(scope, report, 'createdById');

    const res = await this.prisma.maintenanceReport.updateMany({
      where: { id: reportId, tenantId },
      data:  { status: 'COMPLETED', completedAt: new Date(), notes, completedById: actor.id },
    });
    if (res.count === 0) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    return this.prisma.maintenanceReport.findFirst({ where: { id: reportId, tenantId } });
  }

  /**
   * PRD §IV.4 — Validation remise en service.
   * Side effect : met à jour Bus.status = AVAILABLE.
   * Permission requise : data.maintenance.approve.tenant
   */
  async approve(tenantId: string, reportId: string, actor: CurrentUserPayload) {
    const report = await this.prisma.maintenanceReport.findFirst({
      where: { id: reportId, tenantId },
    });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);

    return this.prisma.$transaction([
      this.prisma.maintenanceReport.updateMany({
        where: { id: reportId, tenantId },
        data:  { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
      }),
      this.prisma.bus.updateMany({
        where: { id: report.busId, tenantId },
        data:  { status: 'AVAILABLE' },
      }),
    ]);
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
