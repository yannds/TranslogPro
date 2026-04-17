/**
 * QuaiService — CRUD quais de gare (Platform model).
 *
 * Isolation multi-tenant : tenantId en condition racine.
 */
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CreatePlatformDto, UpdatePlatformDto } from './dto/create-platform.dto';

@Injectable()
export class QuaiService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, stationId?: string) {
    return this.prisma.platform.findMany({
      where: { tenantId, ...(stationId ? { stationId } : {}) },
      orderBy: [{ code: 'asc' }],
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const platform = await this.prisma.platform.findFirst({
      where: { id, tenantId },
      include: {
        station: { select: { id: true, name: true, city: true } },
      },
    });
    if (!platform) throw new NotFoundException(`Quai ${id} introuvable`);
    return platform;
  }

  async create(tenantId: string, dto: CreatePlatformDto) {
    const station = await this.prisma.station.findFirst({
      where: { id: dto.stationId, tenantId },
    });
    if (!station) throw new NotFoundException(`Station ${dto.stationId} introuvable`);

    const existing = await this.prisma.platform.findUnique({
      where: { tenantId_stationId_code: { tenantId, stationId: dto.stationId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Le code "${dto.code}" existe déjà dans cette station`);

    return this.prisma.platform.create({
      data: {
        tenantId,
        stationId: dto.stationId,
        name:      dto.name,
        code:      dto.code,
        capacity:  dto.capacity ?? 1,
        notes:     dto.notes,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdatePlatformDto) {
    await this.findOne(tenantId, id);
    return this.prisma.platform.update({
      where: { id },
      data: { ...dto },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.platform.delete({ where: { id } });
  }

  async assignTrip(tenantId: string, id: string, tripId: string) {
    const platform = await this.findOne(tenantId, id);
    if (platform.status === 'MAINTENANCE' || platform.status === 'CLOSED') {
      throw new ConflictException(`Le quai ${platform.name} est ${platform.status}`);
    }
    return this.prisma.platform.update({
      where: { id },
      data: { currentTripId: tripId, status: 'OCCUPIED' },
    });
  }

  async releaseTrip(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.platform.update({
      where: { id },
      data: { currentTripId: null, status: 'AVAILABLE' },
    });
  }
}
