/**
 * ParcelTripListener
 *
 * Écoute les événements Trip via l'Outbox et auto-transitionne les colis
 * rattachés aux shipments du trajet, via le WorkflowEngine (ADR-15 compliant).
 *
 *   - trip.started  → colis LOADED     → IN_TRANSIT (action `DEPART`)
 *   - trip.completed → colis IN_TRANSIT → ARRIVED    (action `ARRIVE`)
 *
 * Chaque transition passe individuellement par `engine.transition()` avec
 * un actor système et un `idempotencyKey = parcel-{action}:{tripId}:{parcelId}`
 * — audit, guards et permissions respectés, plus de bulk `updateMany`.
 */
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { ParcelState, ParcelAction } from '../../common/constants/workflow-states';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ParcelTripListener implements OnModuleInit {
  private readonly logger = new Logger(ParcelTripListener.name);

  constructor(
    private readonly prisma:   PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly workflow: WorkflowEngine,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(EventTypes.TRIP_STARTED,   (e) => this.onTripStarted(e));
    this.eventBus.subscribe(EventTypes.TRIP_COMPLETED, (e) => this.onTripCompleted(e));
  }

  /** Trip démarre → colis LOADED → IN_TRANSIT via engine (action DEPART). */
  private async onTripStarted(event: DomainEvent): Promise<void> {
    const tripId   = (event.payload?.tripId as string | undefined) ?? event.aggregateId;
    const tenantId = event.tenantId;

    const parcels = await this.prisma.parcel.findMany({
      where: {
        tenantId,
        status:   ParcelState.LOADED,
        shipment: { tripId },
      },
      select: { id: true, tenantId: true, status: true, version: true },
    });
    if (parcels.length === 0) return;

    this.logger.log(
      `Trip ${tripId} started — engine-transition ${parcels.length} parcels LOADED → IN_TRANSIT`,
    );
    await this.cascadeTransition(parcels, ParcelAction.DEPART, tripId);
  }

  /** Trip terminé → colis IN_TRANSIT → ARRIVED via engine (action ARRIVE). */
  private async onTripCompleted(event: DomainEvent): Promise<void> {
    const tripId   = (event.payload?.tripId as string | undefined) ?? event.aggregateId;
    const tenantId = event.tenantId;

    const parcels = await this.prisma.parcel.findMany({
      where: {
        tenantId,
        status:   ParcelState.IN_TRANSIT,
        shipment: { tripId },
      },
      select: { id: true, tenantId: true, status: true, version: true },
    });
    if (parcels.length === 0) return;

    this.logger.log(
      `Trip ${tripId} completed — engine-transition ${parcels.length} parcels IN_TRANSIT → ARRIVED`,
    );
    await this.cascadeTransition(parcels, ParcelAction.ARRIVE, tripId);
  }

  /**
   * Cascade per-parcel via WorkflowEngine. Chaque transition :
   *   - idempotent (clé = `parcel-{action}:{tripId}:{parcelId}`)
   *   - actor SYSTEM scopé au tenant du colis
   *   - erreur isolée : un colis qui échoue ne bloque pas les autres
   */
  private async cascadeTransition(
    parcels: Array<{ id: string; tenantId: string; status: string; version: number }>,
    action:  string,
    tripId:  string,
  ): Promise<void> {
    const baseActor = { id: 'SYSTEM', roleId: 'SYSTEM' } as Partial<CurrentUserPayload>;
    for (const parcel of parcels) {
      try {
        await this.workflow.transition(parcel as any, {
          action,
          actor:          { ...baseActor, tenantId: parcel.tenantId } as CurrentUserPayload,
          idempotencyKey: `parcel-${action.toLowerCase()}:${tripId}:${parcel.id}`,
        }, {
          aggregateType: 'Parcel',
          persist: async (entity, state, p) => {
            return p.parcel.update({
              where: { id: entity.id },
              data:  { status: state, version: { increment: 1 } },
            }) as Promise<typeof entity>;
          },
        });
      } catch (err) {
        this.logger.warn(
          `Parcel cascade failed tripId=${tripId} parcelId=${parcel.id} action=${action}: ${(err as Error).message}`,
        );
      }
    }
  }
}
