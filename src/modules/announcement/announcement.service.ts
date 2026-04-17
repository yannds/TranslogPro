/**
 * AnnouncementService — CRUD annonces gare (sonores / visuelles).
 *
 * Isolation multi-tenant : tenantId en condition racine.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, stationId?: string, activeOnly = false) {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: {
        tenantId,
        ...(stationId ? { stationId } : {}),
        ...(activeOnly ? {
          isActive: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        } : {}),
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const ann = await this.prisma.announcement.findFirst({
      where: { id, tenantId },
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
    if (!ann) throw new NotFoundException(`Annonce ${id} introuvable`);
    return ann;
  }

  async create(tenantId: string, dto: CreateAnnouncementDto, createdById?: string) {
    if (dto.stationId) {
      const station = await this.prisma.station.findFirst({
        where: { id: dto.stationId, tenantId },
      });
      if (!station) throw new NotFoundException(`Station ${dto.stationId} introuvable`);
    }

    return this.prisma.announcement.create({
      data: {
        tenantId,
        stationId:   dto.stationId,
        title:       dto.title,
        message:     dto.message,
        type:        dto.type ?? 'INFO',
        priority:    dto.priority ?? 0,
        isActive:    dto.isActive ?? true,
        startsAt:    dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt:      dto.endsAt   ? new Date(dto.endsAt)   : undefined,
        createdById,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAnnouncementDto) {
    await this.findOne(tenantId, id);
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...dto,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt:   dto.endsAt   ? new Date(dto.endsAt)   : undefined,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.announcement.delete({ where: { id } });
  }
}
