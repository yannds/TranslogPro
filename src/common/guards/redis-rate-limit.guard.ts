import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Redis } from 'ioredis';
import { Request } from 'express';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';

/** Timeout pour les opérations Redis — évite un hang si Redis est down/lent */
const REDIS_TIMEOUT_MS = 2_000;

/**
 * RATE_LIMIT_KEY — métadonnée attachée via @RateLimit() sur un endpoint.
 */
export const RATE_LIMIT_KEY = 'rate_limit_config';

export interface RateLimitConfig {
  /** Nombre de requêtes autorisées dans la fenêtre */
  limit:       number;
  /** Taille de la fenêtre en millisecondes */
  windowMs:    number;
  /** Clé de partition : 'userId' | 'ip' | 'tenantId' | 'custom' */
  keyBy:       'userId' | 'ip' | 'tenantId';
  /**
   * Suffixe unique identifiant l'endpoint (évite les collisions de clé).
   * Ex: 'sos', 'safety_alert', 'public_report'
   */
  suffix:      string;
  /** Message retourné au client (ne pas exposer de détails internes) */
  message?:    string;
}

/**
 * Décorateur applicatif pour configurer le rate limiting par endpoint.
 *
 * Usage :
 *   @RateLimit({ limit: 3, windowMs: 3600_000, keyBy: 'userId', suffix: 'sos' })
 */
export const RateLimit = (config: RateLimitConfig) =>
  SetMetadata(RATE_LIMIT_KEY, config);

/**
 * RedisRateLimitGuard — sliding window via Redis ZSET (PRD §IV.6, §IV.13, §IV.16)
 *
 * Algorithme sliding window log :
 *   1. Clé Redis : "rl:{suffix}:{partitionValue}"
 *   2. ZADD clé timestamp timestamp   → ajouter l'événement courant
 *   3. ZREMRANGEBYSCORE clé -∞ (now - windowMs)  → purger les anciens
 *   4. ZCARD clé                        → compter les événements dans la fenêtre
 *   5. Si count > limit → 429
 *   6. EXPIRE clé windowMs/1000 + marge → TTL auto-nettoyage
 *
 * Avantages vs fixed window :
 *   - Pas de burst en début de fenêtre (ex: 3 SOS en 1s juste après minuit)
 *   - Précision à la milliseconde
 *   - Compatible Redis Cluster (ZSET atomique sur un seul shard)
 *
 * Limites par endpoint (PRD) :
 *   SOS          : 3  / heure / userId
 *   SafetyAlert  : 10 / heure / userId
 *   PublicReport : 5  / heure / IP     (pas de compte requis)
 */
@Injectable()
export class RedisRateLimitGuard implements CanActivate {
  private readonly log = new Logger(RedisRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    // Pas de @RateLimit() sur cet endpoint → laisser passer
    if (!config) return true;

    const req = context.switchToHttp().getRequest<Request & {
      user?: { id?: string; tenantId?: string };
    }>();

    const partitionValue = this.resolvePartitionKey(req, config.keyBy);
    if (!partitionValue) {
      // Impossible de déterminer la clé → refuser (fail-closed)
      throw new HttpException(
        config.message ?? 'Trop de requêtes — réessayez plus tard',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const redisKey = `rl:${config.suffix}:${partitionValue}`;
    const now      = Date.now();
    const windowStart = now - config.windowMs;

    // Pipeline atomique : ZADD + ZREMRANGEBYSCORE + ZCARD + EXPIRE
    // Fail-open avec timeout : si Redis est down/lent, on laisse passer
    // plutôt que de bloquer la requête indéfiniment.
    let count: number;
    try {
      const result = await Promise.race([
        this.redis
          .pipeline()
          .zadd(redisKey, now, `${now}`)
          .zremrangebyscore(redisKey, '-inf', windowStart)
          .zcard(redisKey)
          .expire(redisKey, Math.ceil(config.windowMs / 1_000) + 60)
          .exec(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Redis timeout')), REDIS_TIMEOUT_MS),
        ),
      ]) as [unknown, unknown, [unknown, number], unknown];

      count = result[2]?.[1] ?? 0;
    } catch (e) {
      this.log.warn(`Rate limit check failed (${(e as Error).message}) — fail-open for ${config.suffix}`);
      return true;
    }

    if (count > config.limit) {
      const retryAfterSec = Math.ceil(config.windowMs / 1_000);
      throw new HttpException(
        {
          statusCode:  HttpStatus.TOO_MANY_REQUESTS,
          message:     config.message ?? `Limite dépassée (${config.limit}/${Math.round(config.windowMs / 60_000)}min)`,
          retryAfter:  retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private resolvePartitionKey(
    req:   Request & { user?: { id?: string; tenantId?: string } },
    keyBy: RateLimitConfig['keyBy'],
  ): string | null {
    switch (keyBy) {
      case 'userId':
        return req.user?.id ?? null;
      case 'tenantId':
        return req.user?.tenantId ?? null;
      case 'ip':
        // X-Forwarded-For (derrière Nginx/Kong) avec fallback socket
        return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
          ?? req.socket?.remoteAddress
          ?? null;
    }
  }
}
