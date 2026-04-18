/**
 * PathTenantMatchGuard — unit tests.
 *
 * Matrice (host.tenantId vs path.tenantId/slug) :
 *
 *   host  | path.tenant | path.slug | verdict
 *   ------+-------------+-----------+--------
 *   null  | X           | -         | ALLOW  (pas de host résolu)
 *   A     | -           | -         | ALLOW  (pas de param path)
 *   A     | A           | -         | ALLOW  (match)
 *   A     | B           | -         | DENY   (mismatch — passoire fermée)
 *   A     | -           | A         | ALLOW  (match slug)
 *   A     | -           | B         | DENY   (mismatch slug)
 *   PLATF | B           | -         | ALLOW  (super-admin override)
 *   A     | B (imp→B)   | -         | ALLOW  (impersonation : host=target)
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PathTenantMatchGuard } from '../../../src/core/tenancy/path-tenant-match.guard';
import { PLATFORM_TENANT_ID } from '../../../src/core/tenancy/tenant-resolver.service';

function mockCtx(req: any): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('PathTenantMatchGuard', () => {
  let guard: PathTenantMatchGuard;

  beforeEach(() => {
    guard = new PathTenantMatchGuard();
  });

  // ─── Cas autorisants ──────────────────────────────────────────────────────

  it('ALLOW quand aucun host résolu (ex: Bearer token, tests)', () => {
    expect(guard.canActivate(mockCtx({
      params: { tenantId: 'any-id' },
      path: '/api/tenants/any-id/display',
    }))).toBe(true);
  });

  it('ALLOW quand host résolu mais path sans :tenantId ni :tenantSlug', () => {
    expect(guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', source: 'host' },
      params: {},
      path: '/api/auth/me',
    }))).toBe(true);
  });

  it('ALLOW quand path.tenantId match host.tenantId', () => {
    expect(guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', source: 'host' },
      params: { tenantId: 'A' },
      path: '/api/tenants/A/display',
    }))).toBe(true);
  });

  it('ALLOW quand path.tenantSlug match host.slug', () => {
    expect(guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', source: 'host' },
      params: { tenantSlug: 'a' },
      path: '/api/public/a/portal/config',
    }))).toBe(true);
  });

  it('ALLOW super-admin plateforme sur n\'importe quel path tenant', () => {
    expect(guard.canActivate(mockCtx({
      user: { id: 'sa', tenantId: PLATFORM_TENANT_ID },
      resolvedHostTenant: { tenantId: 'A', slug: 'a', source: 'host' },
      params: { tenantId: 'B-cross-tenant' },
      path: '/api/tenants/B-cross-tenant/display',
    }))).toBe(true);
  });

  it('ALLOW quand impersonation.targetTenantId match host', () => {
    expect(guard.canActivate(mockCtx({
      user: { id: 'actor', tenantId: PLATFORM_TENANT_ID },
      resolvedHostTenant: { tenantId: 'A', slug: 'a', source: 'host' },
      impersonation: {
        sessionId: 's1', targetTenantId: 'A',
        actorId: 'actor', actorTenantId: PLATFORM_TENANT_ID,
      },
      params: { tenantId: 'A' },
      path: '/api/tenants/A/display',
    }))).toBe(true);
  });

  // ─── Cas bloquants (la passoire est fermée) ──────────────────────────────

  it('DENY quand path.tenantId ≠ host.tenantId (cross-tenant leak fermé)', () => {
    expect(() => guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', hostname: 'a.test', source: 'host' },
      params: { tenantId: 'B-UUID' },
      path: '/api/tenants/B-UUID/display',
      ip: '1.2.3.4',
    }))).toThrow(ForbiddenException);
  });

  it('DENY quand path.tenantSlug ≠ host.slug', () => {
    expect(() => guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', hostname: 'a.test', source: 'host' },
      params: { tenantSlug: 'b' },
      path: '/api/public/b/portal/config',
      ip: '1.2.3.4',
    }))).toThrow(ForbiddenException);
  });

  it('DENY même si user authentifié (non-plateforme) tente cross-tenant', () => {
    expect(() => guard.canActivate(mockCtx({
      user: { id: 'u', tenantId: 'A' },
      resolvedHostTenant: { tenantId: 'A', slug: 'a', hostname: 'a.test', source: 'host' },
      params: { tenantId: 'B-UUID' },
      path: '/api/tenants/B-UUID/display',
    }))).toThrow(ForbiddenException);
  });

  it('DENY pour un path avec les DEUX params si slug match mais tenantId mismatch', () => {
    expect(() => guard.canActivate(mockCtx({
      resolvedHostTenant: { tenantId: 'A', slug: 'a', hostname: 'a.test', source: 'host' },
      params: { tenantId: 'B-UUID', tenantSlug: 'a' },
      path: '/weird/B-UUID/a',
    }))).toThrow(ForbiddenException);
  });
});
