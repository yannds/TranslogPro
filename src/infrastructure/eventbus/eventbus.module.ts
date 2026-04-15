import { Module, Global } from '@nestjs/common';
import { Redis } from 'ioredis';
import { OutboxService } from './outbox.service';
import { OutboxPollerService } from './outbox-poller.service';
import { RedisPublisherService, REDIS_CLIENT } from './redis-publisher.service';
import { EVENT_BUS } from './interfaces/eventbus.interface';
import { SECRET_SERVICE, ISecretService } from '../secret/interfaces/secret.interface';

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
    /**
     * REDIS_CLIENT — async provider qui crée sa propre connexion Redis.
     *
     * Pourquoi async (et non useFactory synchrone via publisher.getClient()) :
     * NestJS résout les useFactory AVANT d'appeler onModuleInit() sur les autres
     * providers. Si le factory synchrone appelle publisher.getClient(), il capture
     * `undefined` (client pas encore connecté). L'async factory est await-ée par
     * NestFactory.create() → le client est prêt avant tout usage.
     */
    {
      provide:    REDIS_CLIENT,
      useFactory: async (secretService: ISecretService): Promise<Redis> => {
        const config = await secretService.getSecretObject<{
          HOST: string; PORT: string; PASSWORD?: string;
        }>('platform/redis');

        const client = new Redis({
          host:          config.HOST,
          port:          parseInt(config.PORT, 10),
          password:      config.PASSWORD || undefined,
          lazyConnect:   true,
          retryStrategy: (times) => Math.min(times * 100, 3_000),
        });
        await client.connect();
        return client;
      },
      inject: [SECRET_SERVICE],
    },
  ],
  exports: [EVENT_BUS, RedisPublisherService, OutboxService, REDIS_CLIENT],
})
export class EventBusModule {}
