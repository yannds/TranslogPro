import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisPublisherService } from '../../infrastructure/eventbus/redis-publisher.service';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

const GPS_API_THROTTLE_S  = 5;   // max 1 write/5s to API
const GPS_DB_THROTTLE_S   = 10;  // max 1 write/10s to DB
const GPS_REPLAY_WINDOW_S = 300; // 5 min replay window for WS reconnect
const GPS_REPLAY_MAX      = 100; // max events stored per trip

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma:     PrismaService,
    private readonly publisher:  RedisPublisherService,
  ) {}

  async updateGps(
    tenantId: string,
    tripId:   string,
    lat:      number,
    lng:      number,
    speed?:   number,
    heading?: number,
  ) {
    const redis = this.publisher.getClient();
    const now   = Math.floor(Date.now() / 1000);

    // ── Tier 1: API-rate throttle (1/5s) ──────────────────────────────────
    const apiKey = `gps:api:${tripId}`;
    const apiSet = await redis.set(apiKey, '1', 'EX', GPS_API_THROTTLE_S, 'NX');
    if (!apiSet) return; // throttled — silently discard

    // ── Tier 2: Redis Pub/Sub fan-out (always — no throttle) ──────────────
    const event = {
      id:            uuidv4(),
      type:          EventTypes.GPS_UPDATED,
      tenantId,
      aggregateId:   tripId,
      aggregateType: 'Trip',
      payload:       { tripId, lat, lng, speed, heading, ts: now },
      occurredAt:    new Date(),
    };
    await this.publisher.publish(event);

    // Store last N events for WS replay on reconnect
    const replayKey = `gps:replay:${tripId}`;
    await redis.lpush(replayKey, JSON.stringify(event));
    await redis.ltrim(replayKey, 0, GPS_REPLAY_MAX - 1);
    await redis.expire(replayKey, GPS_REPLAY_WINDOW_S);

    // ── Tier 3: DB write throttle (1/10s) ─────────────────────────────────
    const dbKey = `gps:db:${tripId}`;
    const dbSet = await redis.set(dbKey, '1', 'EX', GPS_DB_THROTTLE_S, 'NX');
    if (!dbSet) return; // DB write throttled — already fanned-out via Redis

    await this.prisma.gpsPosition.create({
      data: { tenantId, tripId, lat, lng, speed, heading, recordedAt: new Date() },
    });
  }

  async getLastPosition(tenantId: string, tripId: string) {
    return this.prisma.gpsPosition.findFirst({
      where:   { tenantId, tripId },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async getReplayEvents(tripId: string): Promise<unknown[]> {
    const redis  = this.publisher.getClient();
    const raw    = await redis.lrange(`gps:replay:${tripId}`, 0, GPS_REPLAY_MAX - 1);
    return raw.map(r => JSON.parse(r));
  }

  async getTripHistory(tenantId: string, tripId: string, limit = 500) {
    return this.prisma.gpsPosition.findMany({
      where:   { tenantId, tripId },
      orderBy: { recordedAt: 'asc' },
      take:    limit,
    });
  }
}
