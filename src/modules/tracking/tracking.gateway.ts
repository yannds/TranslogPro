import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisPublisherService } from '../../infrastructure/eventbus/redis-publisher.service';
import { DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { websocketCorsConfig } from '../../common/security/cors.helper';

import { v4 as uuidv4 } from 'uuid';

// ─── Types stricts ────────────────────────────────────────────────────────────

interface GpsUpdatePayload {
  tripId:  string;
  lat:     number;
  lng:     number;
  speed?:  number;
  heading?: number;
}

interface JoinTripPayload {
  tripId:   string;
  tenantId: string;
  token:    string;   // session Better Auth token — validation obligatoire
}

interface AuthenticatedSocket extends Socket {
  data: {
    userId:   string;
    tenantId: string;
    roleId:   string;
  };
}

// Nombre max de positions GPS buffered en Redis pour replay (100 derniers points)
const GPS_REPLAY_BUFFER = 100;
// Throttle GPS : 1 update/sec max par tripId (Redis SETNX)
const GPS_THROTTLE_MS   = 1_000;

/**
 * TrackingGateway — WebSocket GPS temps réel (PRD §IV.14, §II.4)
 *
 * Namespace : /gps  (distinct de /realtime pour les écrans display)
 * Port      : 3001  (configuré dans main.ts)
 *
 * Sécurité :
 *   1. handleConnection() valide le token Better Auth sur CHAQUE connexion.
 *      Les sockets sans token valide sont déconnectés immédiatement.
 *   2. join:trip vérifie que l'utilisateur a accès au tripId demandé (FK tenant).
 *   3. gps:update : seul le chauffeur du trip (driverId) peut émettre des positions.
 *   4. Throttle Redis : 1 update GPS/s/tripId — évite le flooding.
 *   5. Buffer Redis LRU : 100 dernières positions pour replay (voyageur déconnecté).
 *   6. Rooms scopées : tenant:tripId — aucun cross-tenant possible.
 *
 * Rooms :
 *   trip:{tenantId}:{tripId} → voyageurs qui suivent ce trajet
 *   driver:{userId}          → chauffeur (émet uniquement)
 */
@WebSocketGateway({
  cors:      websocketCorsConfig(),
  namespace: '/gps',
})
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(TrackingGateway.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly publisher: RedisPublisherService,
  ) {}

  // ─── Connexion / Déconnexion ─────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`[GPS] Connection refused — no token (${client.id})`);
      client.emit('error', { code: 'AUTH_REQUIRED', message: 'Token requis' });
      client.disconnect(true);
      return;
    }

    // Validation du token Better Auth via DB Session
    const session = await this.prisma.session.findUnique({
      where:  { token },
      select: { userId: true, tenantId: true, expiresAt: true },
    });

    if (!session || session.expiresAt < new Date()) {
      this.logger.warn(`[GPS] Connection refused — invalid/expired token (${client.id})`);
      client.emit('error', { code: 'AUTH_INVALID', message: 'Token invalide ou expiré' });
      client.disconnect(true);
      return;
    }

    // Récupérer le rôle pour autorisation GPS emission
    const user = await this.prisma.user.findUnique({
      where:  { id: session.userId },
      select: { roleId: true },
    });

    (client as AuthenticatedSocket).data = {
      userId:   session.userId,
      tenantId: session.tenantId,
      roleId:   user?.roleId ?? '',
    };

    this.logger.debug(`[GPS] Connected userId=${session.userId} tenantId=${session.tenantId}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[GPS] Disconnected ${client.id}`);
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  /**
   * Rejoindre la room GPS d'un trajet (voyageur, admin).
   * Vérifie que le tripId appartient au tenant de l'utilisateur.
   */
  @SubscribeMessage('join:trip')
  async handleJoinTrip(
    @MessageBody()   data:   JoinTripPayload,
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { tenantId, userId } = client.data;

    if (!userId) {
      throw new WsException('Non authentifié');
    }

    // Vérifier que le trip appartient au tenant
    const trip = await this.prisma.trip.findFirst({
      where:  { id: data.tripId, tenantId },
      select: { id: true, status: true },
    });

    if (!trip) {
      throw new WsException(`Trip ${data.tripId} introuvable pour ce tenant`);
    }

    const room = `trip:${tenantId}:${data.tripId}`;
    await client.join(room);

    // Envoyer les dernières positions en replay depuis Redis
    const redis   = this.publisher.getClient();
    const history = await redis.lrange(`gps:replay:${data.tripId}`, 0, GPS_REPLAY_BUFFER - 1);
    const parsed  = history.map(e => JSON.parse(e) as GpsUpdatePayload).reverse();

    client.emit('gps:joined', { room, replay: parsed, tripStatus: trip.status });
    this.logger.debug(`[GPS] User ${userId} joined room ${room}`);
  }

  /**
   * Mise à jour GPS émise par le chauffeur.
   * Protection :
   *   1. Seul le chauffeur assigné au trip peut émettre.
   *   2. Throttle Redis : 1 update/s/tripId.
   *   3. Buffering Redis pour replay.
   */
  @SubscribeMessage('gps:update')
  async handleGpsUpdate(
    @MessageBody()   payload: GpsUpdatePayload,
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { userId, tenantId } = client.data;

    if (!userId) throw new WsException('Non authentifié');

    // Validation structure stricte
    if (
      typeof payload.tripId !== 'string'   ||
      typeof payload.lat    !== 'number'   ||
      typeof payload.lng    !== 'number'   ||
      payload.lat  < -90   || payload.lat  > 90   ||
      payload.lng  < -180  || payload.lng  > 180
    ) {
      throw new WsException('Coordonnées GPS invalides');
    }

    // Vérifier que l'utilisateur est bien le chauffeur du trip
    const trip = await this.prisma.trip.findFirst({
      where:  { id: payload.tripId, tenantId, driverId: userId },
      select: { id: true },
    });

    if (!trip) {
      throw new WsException('Accès GPS refusé — vous n\'êtes pas le chauffeur de ce trajet');
    }

    // Throttle Redis — 1 update/s/tripId (SETNX avec TTL)
    const redis        = this.publisher.getClient();
    const throttleKey  = `gps:throttle:${payload.tripId}`;
    const allowed      = await redis.set(throttleKey, '1', 'PX', GPS_THROTTLE_MS, 'NX');

    if (!allowed) {
      // Silencieux — ne pas déconnecter, juste ignorer
      return;
    }

    const now       = Date.now();
    const gpsPoint  = { ...payload, tenantId, recordedAt: now };

    // 1. Persister en DB (GpsPosition)
    await this.prisma.gpsPosition.create({
      data: {
        tenantId,
        tripId:     payload.tripId,
        lat:        payload.lat,
        lng:        payload.lng,
        speed:      payload.speed,
        heading:    payload.heading,
        recordedAt: new Date(now),
      },
    });

    // 2. Mettre à jour Trip.currentLat/Lng
    await this.prisma.trip.update({
      where: { id: payload.tripId },
      data: {
        currentLat: payload.lat,
        currentLng: payload.lng,
        lastGpsAt:  new Date(now),
      },
    });

    // 3. Buffer Redis LRU (replay)
    const bufKey = `gps:replay:${payload.tripId}`;
    await redis.lpush(bufKey, JSON.stringify(gpsPoint));
    await redis.ltrim(bufKey, 0, GPS_REPLAY_BUFFER - 1);
    await redis.expire(bufKey, 3 * 3600); // TTL 3h

    // 4. Fan-out via Redis Pub/Sub → tous les clients dans la room
    const gpsEvent: DomainEvent = {
      id:            uuidv4(),
      type:          'gps.position',
      tenantId,
      aggregateId:   payload.tripId,
      aggregateType: 'Trip',
      payload:       gpsPoint as unknown as Record<string, unknown>,
      occurredAt:    new Date(now),
    };
    await this.publisher.publish(gpsEvent);

    // 5. Emit directement dans la room Socket.io
    const room = `trip:${tenantId}:${payload.tripId}`;
    this.server.to(room).emit('gps:position', gpsPoint);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private extractToken(client: Socket): string | null {
    // Priorité : auth.token → query.token → header Authorization Bearer
    const auth = client.handshake.auth as Record<string, unknown>;
    if (typeof auth['token'] === 'string' && auth['token']) return auth['token'];

    const query = client.handshake.query;
    if (typeof query['token'] === 'string' && query['token']) return query['token'];

    const bearer = client.handshake.headers['authorization'];
    if (typeof bearer === 'string' && bearer.startsWith('Bearer ')) {
      return bearer.slice(7);
    }

    return null;
  }
}
