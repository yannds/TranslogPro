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
        plateNumber: dto.plateNumber,
        type:        dto.type,
        capacity:    dto.capacity,
        agencyId:    dto.agencyId,
        model:       dto.model,
        year:        dto.year,
        status:      'AVAILABLE',
        version:     0,
      },
    });
  }

  /**
   * PRD §IV.3 — seatLayout obligatoire avant toute vente numérotée.
   * Permission: control.fleet.layout.tenant
   */
  async setSeatLayout(tenantId: string, id: string, seatLayout: Record<string, unknown>) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({
      where: { id },
      data:  { seatLayout },
    });
  }

  /**
   * Filtre selon le scope PRD §V.1 :
   *   agency → agencyId = actor.agencyId
   *   tenant → tous les bus du tenant (RLS garantit l'isolation)
   */
  async findAll(tenantId: string, scope: ScopeContext) {
    const agencyFilter = scope.scope === 'agency' ? { agencyId: scope.agencyId } : {};
    return this.prisma.bus.findMany({
      where:   { tenantId, ...agencyFilter },
      orderBy: { plateNumber: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${id} introuvable`);
    return bus;
  }

  /**
   * scope agency : un agent d'agence ne peut modifier le statut
   * que d'un bus appartenant à son agence.
   */
  async updateStatus(tenantId: string, id: string, status: string, scope: ScopeContext) {
    const bus = await this.findOne(tenantId, id);
    if (scope.scope === 'agency' && bus.agencyId !== scope.agencyId) {
      throw new NotFoundException(`Bus ${id} introuvable dans votre agence`);
    }
    return this.prisma.bus.update({ where: { id }, data: { status } });
  }

  async getDisplayInfo(tenantId: string, busId: string) {
    const bus = await this.prisma.bus.findFirst({
      where:   { id: busId, tenantId },
      include: {
        trips: {
          where:   { status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS'] } },
          orderBy: { departureTime: 'asc' },
          take:    1,
          include: { route: true },
        },
      },
    });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);
    return bus;
  }
}
