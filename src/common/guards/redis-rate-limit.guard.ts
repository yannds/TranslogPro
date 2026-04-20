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
  /**
   * Clé de partition :
   *   - 'userId'   : req.user.id (auth required)
   *   - 'ip'       : X-Forwarded-For ou socket
   *   - 'tenantId' : req.user.tenantId
   *   - 'phone'    : valeur extraite du body via `phonePath`
   *                  (flows publics anonymes — rate-limit par cible)
   */
  keyBy:       'userId' | 'ip' | 'tenantId' | 'phone';
  /**
   * Chemin d'accès (dot-notation) vers le phone dans req.body, OU liste de
   * chemins (on rate-limit chaque phone résolu). Requis si keyBy='phone'.
   *
   * Exemples :
   *   - `passengers[].phone`        → tous les phones des passagers (booking)
   *   - `senderPhone,recipientPhone`→ sender ET recipient (parcel)
   *   - `phone`                     → phone direct au root
   */
  phonePath?:  string;
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
 * Usage simple :
 *   @RateLimit({ limit: 3, windowMs: 3600_000, keyBy: 'userId', suffix: 'sos' })
 *
 * Usage combiné (plusieurs dimensions — IP + phone par ex.) :
 *   @RateLimit([
 *     { limit: 5,  windowMs: 3600_000, keyBy: 'ip',    suffix: 'booking_ip'    },
 *     { limit: 3,  windowMs: 3600_000, keyBy: 'phone', suffix: 'booking_phone',
 *       phonePath: 'passengers[].phone' },
 *   ])
 *
 * Toutes les dimensions doivent passer : si UNE SEULE dépasse → 429.
 */
export const RateLimit = (config: RateLimitConfig | RateLimitConfig[]) =>
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
    const raw = this.reflector.get<RateLimitConfig | RateLimitConfig[] | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!raw) return true;

    const configs = Array.isArray(raw) ? raw : [raw];
    const req = context.switchToHttp().getRequest<Request & {
      user?: { id?: string; tenantId?: string };
    }>();

    // Toutes les dimensions doivent passer (AND logique).
    for (const config of configs) {
      await this.checkOne(req, config);
    }
    return true;
  }

  private async checkOne(
    req: Request & { user?: { id?: string; tenantId?: string } },
    config: RateLimitConfig,
  ): Promise<void> {
    // keyBy='phone' → possiblement N phones ; rate-limit chacun.
    if (config.keyBy === 'phone') {
      const phones = this.extractPhones(req, config.phonePath);
      if (phones.length === 0) {
        // Pas de phone dans le body → fail-closed (payload malformé).
        throw new HttpException(
          config.message ?? 'Requête invalide',
          HttpStatus.BAD_REQUEST,
        );
      }
      for (const phone of phones) {
        await this.checkPartition(`rl:${config.suffix}:phone:${phone}`, config);
      }
      return;
    }

    const partitionValue = this.resolvePartitionKey(req, config.keyBy);
    if (!partitionValue) {
      throw new HttpException(
        config.message ?? 'Trop de requêtes — réessayez plus tard',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.checkPartition(`rl:${config.suffix}:${partitionValue}`, config);
  }

  /** Vérifie une partition (IP, userId, phone…) — retourne true sinon throw 429. */
  private async checkPartition(redisKey: string, config: RateLimitConfig): Promise<boolean> {
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
      case 'phone':
        // géré séparément dans canActivate (peut produire N partitions)
        return null;
    }
  }

  /**
   * Extrait les phones du body selon `phonePath` (dot-notation, `[]` pour les
   * tableaux, virgule pour plusieurs chemins).
   * Normalise trivialement (lowercase + trim) — la normalisation E.164
   * définitive se fait au DTO ; ici on veut juste une clé de rate-limit stable.
   */
  private extractPhones(req: Request, path?: string): string[] {
    if (!path) return [];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const phones = new Set<string>();
    for (const p of path.split(',').map(s => s.trim()).filter(Boolean)) {
      const values = this.resolvePath(body, p);
      for (const v of values) {
        if (typeof v === 'string' && v.trim()) phones.add(v.trim().toLowerCase());
      }
    }
    return Array.from(phones);
  }

  private resolvePath(root: unknown, path: string): unknown[] {
    // Support `a.b[].c` et `a.b.c`
    const parts = path.split('.');
    let current: unknown[] = [root];
    for (const part of parts) {
      const next: unknown[] = [];
      const isArr = part.endsWith('[]');
      const key   = isArr ? part.slice(0, -2) : part;
      for (const cur of current) {
        if (!cur || typeof cur !== 'object') continue;
        const v = (cur as Record<string, unknown>)[key];
        if (isArr && Array.isArray(v)) next.push(...v);
        else if (v !== undefined) next.push(v);
      }
      current = next;
    }
    return current;
  }
}
