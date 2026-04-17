import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { RefundService } from './refund.service';

@Injectable()
export class RefundTripListener implements OnModuleInit {
  private readonly logger = new Logger(RefundTripListener.name);

  constructor(
    private readonly refundService: RefundService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit() {
    this.eventBus.subscribe(EventTypes.TRIP_CANCELLED, (e) => this.onTripCancelled(e));
  }

  private async onTripCancelled(event: DomainEvent): Promise<void> {
    const tripId   = event.payload?.tripId ?? event.aggregateId;
    const tenantId = event.tenantId;

    this.logger.log(`TRIP_CANCELLED → creating refunds for trip ${tripId}`);

    try {
      const refunds = await this.refundService.createBulkForTrip(tenantId, tripId as string);
      this.logger.log(`Created ${refunds.length} refund(s) for cancelled trip ${tripId}`);
    } catch (err) {
      this.logger.error(`Failed to create refunds for trip ${tripId}`, (err as Error).stack);
    }
  }
}
