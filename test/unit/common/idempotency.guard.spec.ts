import { ExecutionContext } from '@nestjs/common';
import { IdempotencyGuard } from '../../../src/common/idempotency/idempotency.guard';

/**
 * Tests unit — IdempotencyGuard (2026-04-20).
 *
 * Redis Map mock :
 *   - set NX → retourne null si clé existe, 'OK' sinon
 *   - get    → retourne la valeur ou null
 *
 * Scénarios :
 *   - Pas de @Idempotent() → passage libre
 *   - Pas de header Idempotency-Key → passage libre (opt-in client)
 *   - Clé vierge → SETNX 'pending' → guard passe
 *   - Clé en pending → 409 (concurrent)
 *   - Clé avec réponse cachée → renvoie cache (return false)
 */
describe('IdempotencyGuard', () => {
  function makeCtx(opts: {
    config?: { scope: string; ttlSec?: number } | null;
    idempotencyKey?: string;
    params?: Record<string, string>;
  }): { ctx: ExecutionContext; res: any; req: any } {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const req: any = {
      headers: opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {},
      params:  opts.params ?? { tenantSlug: 'trans-express' },
      body:    {},
    };
    const ctx = {
      getHandler: () => ({}),
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { ctx, res, req };
  }

  function makeGuard(redisState: Map<string, string> = new Map()) {
    const redis: any = {
      set: jest.fn().mockImplementation(async (key: string, value: string, _mode: string, _ttl: number, nx?: string) => {
        if (nx === 'NX') {
          if (redisState.has(key)) return null;
          redisState.set(key, value);
          return 'OK';
        }
        redisState.set(key, value);
        return 'OK';
      }),
      get: jest.fn().mockImplementation(async (key: string) => redisState.get(key) ?? null),
      del: jest.fn().mockImplementation(async (key: string) => { redisState.delete(key); return 1; }),
    };
    const reflector = { get: jest.fn() };
    const guard = new IdempotencyGuard(reflector as any, redis);
    return { guard, redis, reflector, redisState };
  }

  it('passe si pas de @Idempotent()', async () => {
    const { guard, reflector } = makeGuard();
    reflector.get.mockReturnValue(undefined);
    const { ctx } = makeCtx({ idempotencyKey: 'abcd1234efgh' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passe si pas de header Idempotency-Key', async () => {
    const { guard, reflector, redis } = makeGuard();
    reflector.get.mockReturnValue({ scope: 'booking' });
    const { ctx } = makeCtx({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('1er appel : SETNX "pending" et passe', async () => {
    const { guard, reflector, redis, redisState } = makeGuard();
    reflector.get.mockReturnValue({ scope: 'booking' });
    const { ctx, req } = makeCtx({ idempotencyKey: 'abcd1234efgh' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      'idemp:booking:trans-express:abcd1234efgh',
      '__pending__', 'EX', 86400, 'NX',
    );
    expect(req.__idempotencyRedisKey).toBe('idemp:booking:trans-express:abcd1234efgh');
  });

  it('2e appel pendant requête en cours → 409', async () => {
    const state = new Map<string, string>([
      ['idemp:booking:trans-express:abcd1234efgh', '__pending__'],
    ]);
    const { guard, reflector } = makeGuard(state);
    reflector.get.mockReturnValue({ scope: 'booking' });
    const { ctx } = makeCtx({ idempotencyKey: 'abcd1234efgh' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 409 });
  });

  it('2e appel avec réponse cachée → renvoie la réponse (return false)', async () => {
    const state = new Map<string, string>([
      ['idemp:booking:trans-express:abcd1234efgh', JSON.stringify({ ok: true, id: 'ticket-1' })],
    ]);
    const { guard, reflector } = makeGuard(state);
    reflector.get.mockReturnValue({ scope: 'booking' });
    const { ctx, res } = makeCtx({ idempotencyKey: 'abcd1234efgh' });
    await expect(guard.canActivate(ctx)).resolves.toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, id: 'ticket-1' });
  });

  it('header avec format invalide → traité comme absent (passe)', async () => {
    const { guard, reflector, redis } = makeGuard();
    reflector.get.mockReturnValue({ scope: 'booking' });
    const { ctx } = makeCtx({ idempotencyKey: 'short' }); // < 8 chars
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
