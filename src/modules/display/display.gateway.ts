/**
 * DisplayGateway — WebSocket temps réel pour écrans d'affichage gare.
 *
 * Namespace : /realtime  (distinct de /gps pour les chauffeurs)
 *
 * Rooms supportées (hiérarchie croissante) :
 *   tenant:{tenantId}                        → tous les événements du tenant
 *   tenant:{tenantId}:city:{citySlug}        → NOUVEAU — événements d'une ville
 *   trip:{tenantId}:{tripId}                 → GPS et statut d'un trajet précis
 *
 * Messages entrants :
 *   join:tenant  { tenantId }               → room tenant
 *   join:city    { stationId }              → room ville (résolution via DB)
 *   join:trip    { tripId }                 → room trajet
 *   replay:gps   { tripId }                 → replay des 100 dernières positions
 *
 * Sécurité :
 *   - Chaque connexion valide le token Better Auth contre la table Session.
 *   - join:city vérifie que stationId ∈ tenant du token (anti cross-tenant).
 *   - join:trip vérifie que tripId ∈ tenant du token.
 *   - citySlug normalisé (minuscule, sans accent, tirets) pour cohérence des rooms.
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Logger, Inject } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisPublisherService } from '../../infrastructure/eventbus/redis-publisher.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { websocketCorsConfig } from '../../common/security/cors.helper';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  data: {
    userId:   string;
    tenantId: string;
  };
}

// ─── Gateway ──────────────────────────────────────────────────────────────────

@WebSocketGateway({
  cors:      websocketCorsConfig(),
  namespace: '/realtime',
})
export class DisplayGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer() server: Server;
  private readonly logger     = new Logger(DisplayGateway.name);
  private subscriber: Redis;

  constructor(
    private readonly prisma:       PrismaService,
    private readonly publisher:    RedisPublisherService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async afterInit(_server: Server): Promise<void> {
    const config = await this.secretService.getSecretObject<{
      HOST: string; PORT: string; PASSWORD?: string;
    }>('platform/redis');

    this.subscriber = new Redis({
      host:     config.HOST,
      port:     parseInt(config.PORT, 10),
      password: config.PASSWORD,
    });

    // Pattern : translog:{tenantId}:{eventType}
    await this.subscriber.psubscribe('translog:*', (err) => {
      if (err) this.logger.error(`Redis psubscribe error: ${err.message}`);
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      // Canal : translog:{tenantId}:{eventType}
      const parts     = channel.split(':');
      const tenantId  = parts[1];
      const eventType = parts.slice(2).join(':');

      const payload = JSON.parse(message) as Record<string, unknown>;

      // 1. Fan-out room tenant (tous les abonnés du tenant)
      this.server.to(`tenant:${tenantId}`).emit(eventType, payload);

      // 2. Fan-out room city si le payload contient un citySlug pré-calculé
      //    (publié par TripService/TrackingGateway lors d'un changement de statut)
      const citySlug = payload['citySlug'] as string | undefined;
      if (citySlug) {
        this.server
          .to(`tenant:${tenantId}:city:${citySlug}`)
          .emit(eventType, payload);
      }
    });

    this.logger.log('DisplayGateway initialised with Redis adapter on /realtime');
  }

  // ─── Connexion / Déconnexion ─────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`[Display] Connexion refusée — token absent (${client.id})`);
      client.emit('error', { code: 'AUTH_REQUIRED', message: 'Token requis' });
      client.disconnect(true);
      return;
    }

    const session = await this.prisma.session.findUnique({
      where:  { token },
      select: { userId: true, tenantId: true, expiresAt: true },
    });

    if (!session || session.expiresAt < new Date()) {
      this.logger.warn(`[Display] Connexion refusée — token invalide/expiré (${client.id})`);
      client.emit('error', { code: 'AUTH_INVALID', message: 'Token invalide ou expiré' });
      client.disconnect(true);
      return;
    }

    (client as AuthenticatedSocket).data = {
      userId:   session.userId,
      tenantId: session.tenantId,
    };

    this.logger.debug(`[Display] Connecté userId=${session.userId} tenantId=${session.tenantId}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[Display] Déconnecté ${client.id}`);
  }

  // ─── Messages ────────────────────────────────────────────────────────────────

  /**
   * Rejoindre la room tenant (vue globale — tous les événements du tenant).
   * Le tenantId demandé DOIT correspondre au tenant du token.
   */
  @SubscribeMessage('join:tenant')
  async joinTenantRoom(
    @MessageBody()     data:   { tenantId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { userId, tenantId: authTenantId } = client.data;

    if (!userId) throw new WsException('Non authentifié');

    if (data.tenantId !== authTenantId) {
      throw new WsException('Accès refusé — tenant non autorisé');
    }

    const room = `tenant:${authTenantId}`;
    await client.join(room);
    client.emit('joined', { room, scope: 'tenant' });
    this.logger.debug(`[Display] ${client.id} → room ${room}`);
  }

  /**
   * Rejoindre la room ville (vue agrégée d'une ville pour ce tenant).
   *
   * Résolution : à partir du stationId fourni, récupère station.city,
   * construit le slug et crée/rejoint la room tenant:{tenantId}:city:{citySlug}.
   *
   * Sécurité :
   *   - stationId vérifié comme appartenant au tenant du token (anti cross-tenant).
   *   - citySlug normalisé pour cohérence (même ville, différentes casses).
   */
  @SubscribeMessage('join:city')
  async joinCityRoom(
    @MessageBody()     data:   { stationId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { userId, tenantId } = client.data;

    if (!userId) throw new WsException('Non authentifié');

    // Validation ownership : stationId DOIT appartenir au tenant — anti cross-tenant
    const station = await this.prisma.station.findFirst({
      where:  { id: data.stationId, tenantId },
      select: { city: true, name: true },
    });

    if (!station) {
      throw new WsException(`Station ${data.stationId} introuvable pour ce tenant`);
    }

    if (!station.city) {
      throw new WsException(
        `La gare "${station.name}" n'a pas de ville configurée — scope city indisponible`,
      );
    }

    const citySlug = this.toCitySlug(station.city);
    const room     = `tenant:${tenantId}:city:${citySlug}`;

    await client.join(room);
    client.emit('joined', { room, scope: 'city', city: station.city, citySlug });
    this.logger.debug(`[Display] ${client.id} → room ${room} (city=${station.city})`);
  }

  /**
   * Rejoindre la room GPS d'un trajet (suivi temps réel).
   * tripId validé contre le tenant du token.
   */
  @SubscribeMessage('join:trip')
  async joinTripRoom(
    @MessageBody()     data:   { tripId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { userId, tenantId } = client.data;

    if (!userId) throw new WsException('Non authentifié');

    const trip = await this.prisma.trip.findFirst({
      where:  { id: data.tripId, tenantId },
      select: { id: true },
    });

    if (!trip) {
      throw new WsException(`Trajet ${data.tripId} introuvable pour ce tenant`);
    }

    const room = `trip:${tenantId}:${data.tripId}`;
    await client.join(room);
    client.emit('joined', { room, scope: 'trip' });
  }

  /**
   * Replay des 100 dernières positions GPS d'un trajet (buffer Redis LRU).
   * tripId validé contre le tenant du token.
   */
  @SubscribeMessage('replay:gps')
  async replayGps(
    @MessageBody()     data:   { tripId: string },
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<void> {
    const { userId, tenantId } = client.data;

    if (!userId) throw new WsException('Non authentifié');

    const trip = await this.prisma.trip.findFirst({
      where:  { id: data.tripId, tenantId },
      select: { id: true },
    });

    if (!trip) throw new WsException('Trajet introuvable');

    const redis  = this.publisher.getClient();
    const events = await redis.lrange(`gps:replay:${data.tripId}`, 0, 99);
    const parsed = events.map(e => JSON.parse(e) as unknown).reverse();

    client.emit('gps:replay', parsed);
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────────

  private extractToken(client: Socket): string | null {
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

  /**
   * Normalise un nom de ville en slug URL-safe.
   * Ex : "Saint-Louis" → "saint-louis", "Dakar" → "dakar"
   */
  private toCitySlug(city: string): string {
    return city
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // supprime les diacritiques
      .replace(/[^a-z0-9]+/g, '-')       // remplace tout caractère non-alphanumérique par -
      .replace(/^-+|-+$/g, '');          // trim tirets en début/fin
  }
}
