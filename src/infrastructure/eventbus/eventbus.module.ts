import { Module, Global } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxPollerService } from './outbox-poller.service';
import { RedisPublisherService } from './redis-publisher.service';
import { EVENT_BUS } from './interfaces/eventbus.interface';

@Global()
@Module({
  providers: [
    RedisPublisherService,
    OutboxService,
    OutboxPollerService,
    {
      provide:  EVENT_BUS,
      useExisting: OutboxService,
    },
  ],
  exports: [EVENT_BUS, RedisPublisherService, OutboxService],
})
export class EventBusModule {}
