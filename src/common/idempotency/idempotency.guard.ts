/**
 * IdempotencyGuard — Garantit qu'un POST public ne s'exécute qu'une fois pour
 * un même `Idempotency-Key` dans la fenêtre de rétention (24h par défaut).
 *
 * Usage :
 *   @Post('booking')
 *   @UseGuards(IdempotencyGuard)
 *   @Idempotent({ scope: 'portal_booking' })
 *   createBooking(...) {}
 *
 * Comportement :
 *   - Client envoie `Idempotency-Key: <uuid>` dans le header.
 *   - Si la clé n'existe pas en Redis → SETNX + laisse passer → le controller
 *     exécute et l'Interceptor (ci-dessous) capture la réponse pour la cacher.
 *   - Si la clé existe déjà → on renvoie directement la réponse cachée (200).
 *   - Si la clé existe mais sans réponse encore cachée (requête concurrente
 *     en cours) → 409 (évite double-submit).
 *   - Si le header est absent → le Guard laisse passer (opt-in côté client,
 *     mais strongly recommended pour les POST qui créent des ressources).
 *
 * Note : on combine un Guard (check pré-exécution) et un Interceptor (cache
 * réponse post-exécution). Le Guard seul ne peut pas cacher la réponse.
 */
import {
  Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger, SetMetadata,
  NestInterceptor, CallHandler, Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Redis } from 'ioredis';
import { Observable, of, tap } from 'rxjs';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';

export const IDEMPOTENCY_KEY = 'idempotency_config';

export interface IdempotencyConfig {
  /** Nom du scope (préfixe Redis) — ex: 'portal_booking', 'parcel_pickup'. */
  scope: string;
  /** TTL de rétention en secondes. Défaut 24h. */
  ttlSec?: number;
}

export const Idempotent = (config: IdempotencyConfig) =>
  SetMetadata(IDEMPOTENCY_KEY, config);

const DEFAULT_TTL_SEC = 24 * 3600;
const HEADER_NAME     = 'idempotency-key';
const CACHE_PENDING   = '__pending__';

@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<IdempotencyConfig>(IDEMPOTENCY_KEY, context.getHandler());
    if (!config) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const key = this.readKey(req);
    if (!key) return true;

    const redisKey = this.buildRedisKey(config.scope, req, key);
    const ttl      = config.ttlSec ?? DEFAULT_TTL_SEC;

    // SETNX "pending" pour marquer la requête en cours
    const setResult = await this.redis.set(redisKey, CACHE_PENDING, 'EX', ttl, 'NX');

    // Clé déjà présente → vérifier si elle a une réponse
    if (setResult === null) {
      const cached = await this.redis.get(redisKey);
      if (cached && cached !== CACHE_PENDING) {
        // Réponse déjà cachée → la renvoyer
        const res = context.switchToHttp().getResponse<{
          status: (code: number) => { json: (body: unknown) => void };
        }>();
        try {
          const body = JSON.parse(cached);
          res.status(HttpStatus.OK).json(body);
        } catch {
          // Cache corrompu → réexécuter (fail-open)
          return true;
        }
        // Bloque le handler (la réponse est déjà envoyée)
        return false;
      }
      if (cached === CACHE_PENDING) {
        // Requête concurrente en cours → 409
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message:    'Requête dupliquée en cours — attendez la fin de la première',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    // Stocker redisKey sur la request pour l'Interceptor
    (req as any).__idempotencyRedisKey = redisKey;
    (req as any).__idempotencyTtl      = ttl;
    return true;
  }

  private readKey(req: Request): string | null {
    const hdr = req.headers[HEADER_NAME];
    if (typeof hdr === 'string' && hdr && /^[A-Za-z0-9_-]{8,64}$/.test(hdr)) return hdr;
    return null;
  }

  private buildRedisKey(scope: string, req: Request, key: string): string {
    const params = req.params as { tenantId?: string; tenantSlug?: string } | undefined;
    const tenantPart = params?.tenantId ?? params?.tenantSlug ?? 'global';
    return `idemp:${scope}:${tenantPart}:${key}`;
  }
}

/**
 * IdempotencyInterceptor — cache la réponse en Redis après exécution du handler.
 * À enregistrer globalement (même liste que le Guard).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { __idempotencyRedisKey?: string; __idempotencyTtl?: number }>();
    const redisKey = req.__idempotencyRedisKey;
    const ttl      = req.__idempotencyTtl;
    if (!redisKey) return next.handle();

    return next.handle().pipe(
      tap({
        next: async (body) => {
          try {
            await this.redis.set(redisKey, JSON.stringify(body), 'EX', ttl ?? DEFAULT_TTL_SEC);
          } catch (err) {
            this.logger.warn(`[Idempotency] cache store failed: ${(err as Error).message}`);
          }
        },
        error: async () => {
          // Libère la clé si le handler échoue, pour ne pas bloquer un retry légitime
          try { await this.redis.del(redisKey); } catch { /* noop */ }
        },
      }),
    );
  }
}
