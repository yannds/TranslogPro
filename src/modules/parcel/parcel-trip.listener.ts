/**
 * ParcelTripListener
 *
 * Écoute les événements Trip via l'Outbox et auto-transitionne
 * les colis rattachés aux shipments du trajet :
 *
 *   - trip.started  → colis LOADED  → IN_TRANSIT
 *   - trip.completed → colis IN_TRANSIT → ARRIVED
 */
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { ParcelState, ParcelAction } from '../../common/constants/workflow-states';

@Injectable()
export class ParcelTripListener implements OnModuleInit {
  private readonly logger = new Logger(ParcelTripListener.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(EventTypes.TRIP_STARTED, (e) => this.onTripStarted(e));
    this.eventBus.subscribe(EventTypes.TRIP_COMPLETED, (e) => this.onTripCompleted(e));
  }

  /**
   * Trip démarre → tous les colis LOADED de ses shipments passent IN_TRANSIT.
   */
  private async onTripStarted(event: DomainEvent): Promise<void> {
    const tripId   = event.payload?.tripId ?? event.aggregateId;
    const tenantId = event.tenantId;

    const parcels = await this.prisma.parcel.findMany({
      where: {
        tenantId,
        status:   ParcelState.LOADED,
        shipment: { tripId },
      },
      select: { id: true },
    });

    if (parcels.length === 0) return;

    this.logger.log(
      `Trip ${tripId} started — transitioning ${parcels.length} parcels LOADED → IN_TRANSIT`,
    );

    await this.prisma.parcel.updateMany({
      where: { id: { in: parcels.map(p => p.id) } },
      data:  { status: ParcelState.IN_TRANSIT, version: { increment: 1 } },
    });
  }

  /**
   * Trip terminé → tous les colis IN_TRANSIT de ses shipments passent ARRIVED.
   */
  private async onTripCompleted(event: DomainEvent): Promise<void> {
    const tripId   = event.payload?.tripId ?? event.aggregateId;
    const tenantId = event.tenantId;

    const parcels = await this.prisma.parcel.findMany({
      where: {
        tenantId,
        status:   ParcelState.IN_TRANSIT,
        shipment: { tripId },
      },
      select: { id: true },
    });

    if (parcels.length === 0) return;

    this.logger.log(
      `Trip ${tripId} completed — transitioning ${parcels.length} parcels IN_TRANSIT → ARRIVED`,
    );

    await this.prisma.parcel.updateMany({
      where: { id: { in: parcels.map(p => p.id) } },
      data:  { status: ParcelState.ARRIVED, version: { increment: 1 } },
    });
  }
}
