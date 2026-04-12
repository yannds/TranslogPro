import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { Inject } from '@nestjs/common';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

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

  async complete(tenantId: string, reportId: string, notes: string, actor: CurrentUserPayload) {
    const report = await this.prisma.maintenanceReport.findFirst({
      where: { id: reportId, tenantId },
    });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);

    return this.prisma.maintenanceReport.update({
      where: { id: reportId },
      data:  { status: 'COMPLETED', completedAt: new Date(), notes, completedById: actor.id },
    });
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
      this.prisma.maintenanceReport.update({
        where: { id: reportId },
        data:  { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
      }),
      this.prisma.bus.update({
        where: { id: report.busId },
        data:  { status: 'AVAILABLE' },
      }),
    ]);
  }

  async getDocumentUploadUrl(tenantId: string, reportId: string) {
    const key = `${tenantId}/maintenance/${reportId}/${Date.now()}.pdf`;
    return this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);
  }

  async findByBus(tenantId: string, busId: string) {
    return this.prisma.maintenanceReport.findMany({
      where:   { tenantId, busId },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async findAll(tenantId: string, status?: string) {
    return this.prisma.maintenanceReport.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      include: { bus: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }
}
