/**
 * Security Test — Auth Brute Force & Rate Limiting
 *
 * Tests unitaires isolés sur RedisRateLimitGuard avec un Redis mock
 * qui simule un compteur croissant (sliding window).
 */
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  RedisRateLimitGuard,
  RateLimitConfig,
  RATE_LIMIT_KEY,
} from '@/common/guards/redis-rate-limit.guard';

// ─── Redis mock (sliding window counter) ───────────────────────────────────────

function createRedisMock(initialCount = 0) {
  let count = initialCount;
  return {
    pipeline: jest.fn().mockReturnValue({
      zadd:             jest.fn().mockReturnThis(),
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard:            jest.fn().mockReturnThis(),
      expire:           jest.fn().mockReturnThis(),
      exec:             jest.fn().mockImplementation(() => Promise.resolve([
        [null, 1],             // zadd
        [null, 0],             // zremrangebyscore
        [null, ++count],       // zcard (croissant à chaque appel)
        [null, 1],             // expire
      ])),
    }),
    __reset: () => { count = initialCount; },
  } as any;
}

function makeContext(req: Partial<Record<string, unknown>>, config: RateLimitConfig | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext:     () => undefined,
    }),
    getHandler: () => ({ __rateLimit: config }),
    getClass:   () => ({}),
  } as unknown as ExecutionContext;
}

describe('[SECURITY] Auth Brute Force & Rate Limiting', () => {
  const reflector = new Reflector();
  const CONFIG: RateLimitConfig = {
    limit:    5,
    windowMs: 15 * 60_000,
    keyBy:    'ip',
    suffix:   'auth_signin',
  };

  beforeEach(() => {
    // On setMetadata manuellement puisqu'on ne passe pas par un décorateur
    jest.spyOn(reflector, 'get').mockImplementation((key) =>
      key === RATE_LIMIT_KEY ? CONFIG : undefined,
    );
  });

  // ── Below limit → allow ────────────────────────────────────────────────────

  it('should allow requests under the limit', async () => {
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {}, user: undefined };

    for (let i = 1; i <= 5; i++) {
      const result = await guard.canActivate(makeContext(req, CONFIG));
      expect(result).toBe(true);
    }
  });

  // ── Above limit → 429 ──────────────────────────────────────────────────────

  it('should block with 429 when limit exceeded', async () => {
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {}, user: undefined };

    // Première vague OK (5 requêtes)
    for (let i = 0; i < 5; i++) {
      await guard.canActivate(makeContext(req, CONFIG));
    }

    // La 6ème doit lever 429
    await expect(guard.canActivate(makeContext(req, CONFIG)))
      .rejects.toThrow(HttpException);
  });

  it('429 response should include retryAfter metadata', async () => {
    const redis = createRedisMock(10); // déjà saturé
    const guard = new RedisRateLimitGuard(reflector, redis);
    const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {}, user: undefined };

    try {
      await guard.canActivate(makeContext(req, CONFIG));
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      const resp = err.getResponse();
      expect(resp).toMatchObject({
        statusCode: 429,
        retryAfter: Math.ceil(CONFIG.windowMs / 1_000),
      });
    }
  });

  // ── Fail-closed: partition key unresolvable ────────────────────────────────

  it('should fail closed (429) when IP cannot be resolved', async () => {
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    // Pas d'IP du tout (ni header ni socket)
    const req: any = { socket: {}, headers: {}, user: undefined };

    await expect(guard.canActivate(makeContext(req, CONFIG)))
      .rejects.toThrow(HttpException);
  });

  it('should fail closed when userId is missing for keyBy=userId', async () => {
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    const userCfg: RateLimitConfig = { ...CONFIG, keyBy: 'userId', suffix: 'test' };
    jest.spyOn(reflector, 'get').mockReturnValue(userCfg);

    const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {}, user: undefined };

    await expect(guard.canActivate(makeContext(req, userCfg)))
      .rejects.toThrow(HttpException);
  });

  // ── No config → pass through ──────────────────────────────────────────────

  it('should bypass when no @RateLimit decorator is set', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(undefined);
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    const req: any = { socket: { remoteAddress: '127.0.0.1' }, headers: {}, user: undefined };

    const result = await guard.canActivate(makeContext(req, undefined));
    expect(result).toBe(true);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  // ── X-Forwarded-For partition ──────────────────────────────────────────────

  it('should use X-Forwarded-For as partition key', async () => {
    const redis = createRedisMock(0);
    const guard = new RedisRateLimitGuard(reflector, redis);
    const req: any = {
      socket: { remoteAddress: '10.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' },
      user: undefined,
    };

    await guard.canActivate(makeContext(req, CONFIG));

    // Vérifier que la clé Redis contient l'IP du client (pas du proxy)
    const pipelineCall = redis.pipeline.mock.results[0].value;
    expect(pipelineCall.zadd).toHaveBeenCalled();
    const [redisKey] = pipelineCall.zadd.mock.calls[0];
    expect(redisKey).toContain('203.0.113.42');
    expect(redisKey).not.toContain('10.0.0.1');
  });
});
