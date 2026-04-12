import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ShipmentState } from '../../common/constants/workflow-states';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma:   PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateShipmentDto, actor: CurrentUserPayload) {
    return this.prisma.shipment.create({
      data: {
        tenantId,
        tripId:          dto.tripId,
        destinationId:   dto.destinationId,
        totalWeight:     dto.maxWeightKg,
        remainingWeight: dto.maxWeightKg,  // décrémenté à chaque ajout de colis
        status:          ShipmentState.OPEN,
      },
    });
  }

  /**
   * PRD §IV.2 — Ajout d'un colis à un shipment.
   *
   * Guards applicatifs :
   *   1. Shipment.destinationId == Parcel.destinationId
   *   2. Shipment.remainingWeight >= Parcel.weightKg
   *   3. Shipment.status == OPEN
   */
  async addParcel(
    tenantId:   string,
    shipmentId: string,
    parcelId:   string,
    actor:      CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const [shipment, parcel] = await Promise.all([
      this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } }),
      this.prisma.parcel.findFirst({ where: { id: parcelId, tenantId } }),
    ]);

    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} introuvable`);
    if (!parcel)   throw new NotFoundException(`Colis ${parcelId} introuvable`);

    // Guard 1 — destination identique
    if (shipment.destinationId !== parcel.destinationId) {
      throw new BadRequestException(
        `Destination du colis (${parcel.destinationId}) ≠ destination du shipment (${shipment.destinationId})`,
      );
    }

    // Guard 2 — capacité poids
    const remaining = shipment.remainingWeight as number;
    const weight    = parcel.weight as number;
    if (remaining < weight) {
      throw new BadRequestException(
        `Capacité insuffisante : ${remaining}kg disponibles, colis pèse ${weight}kg`,
      );
    }

    // Guard 3 — shipment ouvert
    if (shipment.status !== ShipmentState.OPEN) {
      throw new BadRequestException(`Shipment ${shipmentId} n'est plus ouvert (status: ${shipment.status})`);
    }

    return this.prisma.transact(async (tx) => {
      await tx.parcel.update({
        where: { id: parcelId },
        data:  { shipmentId, status: 'PACKED', version: { increment: 1 } },
      });

      const updated = await tx.shipment.update({
        where: { id: shipmentId },
        data:  { remainingWeight: { decrement: weight } },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          'parcel.assigned_to_shipment',
        tenantId,
        aggregateId:   parcelId,
        aggregateType: 'Parcel',
        payload:       { parcelId, shipmentId, weight },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return updated;
    });
  }

  async findOne(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where:   { id, tenantId },
      include: { parcels: true, trip: true, destination: true },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${id} introuvable`);
    return shipment;
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.shipment.findMany({
      where:   { tenantId, tripId },
      include: { parcels: { select: { id: true, trackingCode: true, status: true, weight: true } } },
    });
  }
}
