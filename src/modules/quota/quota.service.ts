import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { RedisPublisherService } from '../../infrastructure/eventbus/redis-publisher.service';

/**
 * PRD §IV.11 — Module N : Quota Manager.
 *
 * Limites applicatives par tenant AVANT que les requêtes atteignent les modules métier.
 * Implémenté via Redis sliding window (INCR + EXPIRE).
 *
 * Limites par défaut (surchargeable via WorkflowConfig/InstalledModule) :
 *   GPS updates   : 1 req / 5s par trip
 *   WS connexions : 500 par tenant
 *   Events/min    : 1000 par tenant
 */
@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);

  // Limites par défaut
  private readonly DEFAULT_LIMITS: Record<string, { max: number; windowSec: number }> = {
    'gps_update':   { max: 1,    windowSec: 5    },
    'ws_connect':   { max: 500,  windowSec: 60   },
    'events_min':   { max: 1000, windowSec: 60   },
    'api_req_min':  { max: 300,  windowSec: 60   },
  };

  constructor(private readonly redisPublisher: RedisPublisherService) {}

  /**
   * Vérifie et consomme un quota.
   * Lève TooManyRequestsException si la limite est dépassée.
   */
  async checkAndConsume(
    tenantId: string,
    resource: string,
    subKey?: string,
  ): Promise<void> {
    const limit = this.DEFAULT_LIMITS[resource];
    if (!limit) return; // quota non configuré → laisser passer

    const redis    = this.redisPublisher.getClient();
    const key      = `quota:${tenantId}:${resource}${subKey ? `:${subKey}` : ''}`;
    const current  = await redis.incr(key);

    if (current === 1) {
      await redis.expire(key, limit.windowSec);
    }

    if (current > limit.max) {
      this.logger.warn(`Quota dépassé: tenant=${tenantId} resource=${resource} count=${current}/${limit.max}`);
      throw new HttpException(
        `Quota "${resource}" dépassé pour ce tenant (${current}/${limit.max} par ${limit.windowSec}s)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async getUsage(tenantId: string) {
    const redis   = this.redisPublisher.getClient();
    const results: Record<string, number | null> = {};

    for (const resource of Object.keys(this.DEFAULT_LIMITS)) {
      const key = `quota:${tenantId}:${resource}`;
      const val = await redis.get(key);
      results[resource] = val !== null ? parseInt(val) : 0;
    }

    return results;
  }
}
