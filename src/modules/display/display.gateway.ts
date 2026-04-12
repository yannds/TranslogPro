import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisPublisherService } from '../../infrastructure/eventbus/redis-publisher.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';

@WebSocketGateway({
  cors:      { origin: '*' },
  namespace: '/realtime',
})
export class DisplayGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(DisplayGateway.name);
  private subscriber: Redis;

  constructor(
    private readonly publisher:     RedisPublisherService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async onModuleInit(): Promise<void> {
    const config = await this.secretService.getSecretObject<{
      HOST: string; PORT: string; PASSWORD?: string;
    }>('platform/redis');

    // Separate Redis client for Pub/Sub (pub and sub cannot share a connection)
    this.subscriber = new Redis({
      host:     config.HOST,
      port:     parseInt(config.PORT),
      password: config.PASSWORD,
    });

    // Redis adapter for horizontal WS scaling across pods
    const pubClient = this.publisher.getClient();
    this.server.adapter(createAdapter(pubClient, this.subscriber));

    // Subscribe to all translog events and forward to relevant Socket.io rooms
    await this.subscriber.psubscribe('translog:*', (err) => {
      if (err) this.logger.error(`Redis psubscribe error: ${err.message}`);
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const [, tenantId, eventType] = channel.split(':');
      const room = `tenant:${tenantId}`;
      this.server.to(room).emit(eventType, JSON.parse(message));
    });

    this.logger.log('DisplayGateway initialised with Redis adapter');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`WS client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join:tenant')
  async joinTenantRoom(
    @MessageBody() data: { tenantId: string; token?: string },
    @ConnectedSocket() client: Socket,
  ) {
    // In production: validate the token before joining
    const room = `tenant:${data.tenantId}`;
    await client.join(room);
    client.emit('joined', { room });
    this.logger.debug(`Client ${client.id} joined room ${room}`);
  }

  @SubscribeMessage('join:trip')
  async joinTripRoom(
    @MessageBody() data: { tenantId: string; tripId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `trip:${data.tenantId}:${data.tripId}`;
    await client.join(room);
    client.emit('joined', { room });
  }

  @SubscribeMessage('replay:gps')
  async replayGps(
    @MessageBody() data: { tripId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const redis  = this.publisher.getClient();
    const events = await redis.lrange(`gps:replay:${data.tripId}`, 0, 99);
    const parsed = events.map(e => JSON.parse(e)).reverse();
    client.emit('gps:replay', parsed);
  }
}
