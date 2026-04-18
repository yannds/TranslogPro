/**
 * current-tenant helpers — unit tests.
 *
 * Couvre les règles de priorité de `getCurrentTenantId` :
 *   impersonation > session > host
 */

import {
  getCurrentTenantId,
  requireCurrentTenantId,
  getCurrentTenantSource,
} from '../../../src/core/tenancy/current-tenant';

describe('getCurrentTenantId', () => {
  it('priorité 1 : impersonation > session > host', () => {
    const req: any = {
      impersonation: { targetTenantId: 'IMP', sessionId: 's', actorId: 'a', actorTenantId: 'P' },
      user:               { tenantId: 'SESS', id: 'u' },
      resolvedHostTenant: { tenantId: 'HOST', slug: 'x', source: 'host' },
    };
    expect(getCurrentTenantId(req)).toBe('IMP');
    expect(getCurrentTenantSource(req)).toBe('impersonation');
  });

  it('priorité 2 : session si pas d\'impersonation', () => {
    const req: any = {
      user:               { tenantId: 'SESS', id: 'u' },
      resolvedHostTenant: { tenantId: 'HOST', slug: 'x', source: 'host' },
    };
    expect(getCurrentTenantId(req)).toBe('SESS');
    expect(getCurrentTenantSource(req)).toBe('session');
  });

  it('priorité 3 : host si pas de session', () => {
    const req: any = { resolvedHostTenant: { tenantId: 'HOST', slug: 'x', source: 'host' } };
    expect(getCurrentTenantId(req)).toBe('HOST');
    expect(getCurrentTenantSource(req)).toBe('host');
  });

  it('null quand rien n\'est résolu', () => {
    expect(getCurrentTenantId({} as any)).toBeNull();
    expect(getCurrentTenantSource({} as any)).toBeNull();
  });

  it('requireCurrentTenantId throw si rien résolu', () => {
    expect(() => requireCurrentTenantId({} as any)).toThrow(/No tenant context/);
  });

  it('requireCurrentTenantId retourne la valeur si OK', () => {
    const req: any = { user: { tenantId: 'X', id: 'u' } };
    expect(requireCurrentTenantId(req)).toBe('X');
  });
});
