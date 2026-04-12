import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DomainEvent } from './interfaces/eventbus.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisPublisherService.name);
  private client: Redis;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = await this.secretService.getSecretObject<{
      HOST: string; PORT: string; PASSWORD?: string;
    }>('platform/redis');

    this.client = new Redis({
      host:            config.HOST,
      port:            parseInt(config.PORT),
      password:        config.PASSWORD,
      lazyConnect:     true,
      retryStrategy:   (times) => Math.min(times * 100, 3_000),
    });

    await this.client.connect();
    this.logger.log(`Redis publisher connected at ${config.HOST}:${config.PORT}`);
  }

  /**
   * Publish the event on a per-tenant channel so WebSocket gateways can
   * subscribe and forward to the correct Socket.io rooms.
   *
   * Channel format: `translog:{tenantId}:{eventType}`
   */
  async publish(event: DomainEvent): Promise<void> {
    const channel = `translog:${event.tenantId}:${event.type}`;
    await this.client.publish(channel, JSON.stringify(event));
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }
}
