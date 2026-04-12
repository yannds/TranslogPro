import { Module, Global } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxPollerService } from './outbox-poller.service';
import { RedisPublisherService, REDIS_CLIENT } from './redis-publisher.service';
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
    // Expose le client Redis brut sous le token REDIS_CLIENT
    // Utilisé par RedisRateLimitGuard et TrackingGateway
    {
      provide:    REDIS_CLIENT,
      useFactory: (publisher: RedisPublisherService) => publisher.getClient(),
      inject:     [RedisPublisherService],
    },
  ],
  exports: [EVENT_BUS, RedisPublisherService, OutboxService, REDIS_CLIENT],
})
export class EventBusModule {}
