/**
 * TenantHostMiddleware — unit tests.
 *
 * Invariants vérifiés :
 *   - Appelle resolver.resolveFromHost(hostname) avec le Host du request
 *   - Injecte req.resolvedHostTenant si match
 *   - Ne jette jamais : next() toujours appelé
 *   - Log l'erreur si resolver throw, ne bloque pas la requête
 *   - Skip si pas de header Host
 */

import { TenantHostMiddleware } from '../../../src/core/tenancy/tenant-host.middleware';

describe('TenantHostMiddleware', () => {
  let middleware: TenantHostMiddleware;
  let mockResolver: { resolveFromHost: jest.Mock };

  beforeEach(() => {
    mockResolver = { resolveFromHost: jest.fn() };
    middleware = new TenantHostMiddleware(mockResolver as any);
  });

  it('injecte resolvedHostTenant quand resolver retourne un match', async () => {
    mockResolver.resolveFromHost.mockResolvedValue({
      tenantId: 'A', slug: 'a', source: 'host', hostname: 'a.translog.test',
    });

    const req: any = { headers: { host: 'a.translog.test' } };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.resolvedHostTenant).toEqual({
      tenantId: 'A', slug: 'a', source: 'host', hostname: 'a.translog.test',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('laisse resolvedHostTenant undefined si resolver retourne null', async () => {
    mockResolver.resolveFromHost.mockResolvedValue(null);

    const req: any = { headers: { host: 'unknown.translog.test' } };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.resolvedHostTenant).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('skip si pas de header Host (next appelé sans lookup)', async () => {
    const req: any = { headers: {} };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(mockResolver.resolveFromHost).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('ne bloque jamais : next() appelé même si resolver throw', async () => {
    mockResolver.resolveFromHost.mockRejectedValue(new Error('DB down'));

    const req: any = { headers: { host: 'a.translog.test' } };
    const next = jest.fn();

    await middleware.use(req, {} as any, next);

    expect(req.resolvedHostTenant).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
