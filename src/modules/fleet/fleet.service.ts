import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { CreateBusDto } from './dto/create-bus.dto';

@Injectable()
export class FleetService {
  constructor(private readonly prisma: PrismaService) {}

  async createBus(tenantId: string, dto: CreateBusDto) {
    return this.prisma.bus.create({
      data: {
        tenantId,
        plateNumber:        dto.plateNumber,
        model:              dto.model ?? '',
        capacity:           dto.capacity,
        luggageCapacityKg:  0,
        luggageCapacityM3:  0,
      },
    });
  }

  /**
   * PRD §IV.3 — seatLayout obligatoire avant toute vente numérotée.
   */
  async setSeatLayout(tenantId: string, id: string, seatLayout: Record<string, unknown>) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data:  { seatLayout: seatLayout as any },
    });
  }

  async findAll(tenantId: string, _scope: ScopeContext) {
    return this.prisma.bus.findMany({
      where:   { tenantId },
      orderBy: { plateNumber: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${id} introuvable`);
    return bus;
  }

  async updateStatus(tenantId: string, id: string, status: string, _scope: ScopeContext) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({ where: { id }, data: { status } });
  }

  async getDisplayInfo(tenantId: string, busId: string) {
    const bus = await this.prisma.bus.findFirst({
      where:   { id: busId, tenantId },
      include: {
        trips: {
          where:   { status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS'] } },
          orderBy: { departureScheduled: 'asc' },
          take:    1,
          include: { route: true },
        },
      },
    });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);
    return bus;
  }
}
