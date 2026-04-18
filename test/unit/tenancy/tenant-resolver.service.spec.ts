/**
 * TenantResolverService — unit tests.
 *
 * Stratégies testées (ordre strict) :
 *   1. TenantDomain exact match (verifiedAt) → retourne immédiatement
 *   2. Admin subdomain → PLATFORM_TENANT_ID
 *   3. Fallback slug direct sur tenants.slug
 *   4. null si aucune stratégie ne matche
 *
 * Invariants :
 *   - TenantDomain non-vérifié (verifiedAt null) ne matche PAS
 *   - Sous-domaines réservés (api, www, …) ne matchent jamais par fallback
 */

import { HostConfigService } from '../../../src/core/tenancy/host-config.service';
import { TenantResolverService, PLATFORM_TENANT_ID } from '../../../src/core/tenancy/tenant-resolver.service';

describe('TenantResolverService', () => {
  let resolver: TenantResolverService;
  let hostConfig: HostConfigService;

  // Mocks
  let mockDomainRepo: { findByHostname: jest.Mock };
  let mockPrisma:     { tenant: { findUnique: jest.Mock } };

  beforeEach(() => {
    process.env.PLATFORM_BASE_DOMAIN = 'translog.test';
    process.env.ADMIN_SUBDOMAIN = 'admin';
    hostConfig = new HostConfigService();

    mockDomainRepo = { findByHostname: jest.fn() };
    mockPrisma = { tenant: { findUnique: jest.fn() } };

    resolver = new TenantResolverService(
      mockPrisma as any,
      hostConfig,
      mockDomainRepo as any,
    );
  });

  // ─── Stratégie 1 : TenantDomain exact match ───────────────────────────────

  it('retourne un ResolvedTenant depuis TenantDomain vérifié', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue({
      tenantId:  'tenant-a-id',
      hostname:  'tenanta.translog.test',
      isPrimary: true,
      verifiedAt: new Date(),
      tenant:    { slug: 'tenanta' },
    });

    const r = await resolver.resolveFromHost('tenanta.translog.test');
    expect(r).toEqual({
      tenantId:  'tenant-a-id',
      slug:      'tenanta',
      source:    'host',
      hostname:  'tenanta.translog.test',
      isPrimary: true,
    });
    // Stratégies 2 et 3 ne sont pas tentées
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('ignore un TenantDomain non vérifié (verifiedAt null)', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue({
      tenantId: 'tenant-a-id', hostname: 'tenanta.translog.test',
      verifiedAt: null, tenant: { slug: 'tenanta' },
    });
    // Fallback stratégie 3
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-a-id', slug: 'tenanta' });

    const r = await resolver.resolveFromHost('tenanta.translog.test');
    expect(r).not.toBeNull();
    expect(r!.tenantId).toBe('tenant-a-id');
    // Fallback a été déclenché
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'tenanta' } });
  });

  // ─── Stratégie 2 : admin subdomain ────────────────────────────────────────

  it('résout admin.translog.test → PLATFORM_TENANT_ID', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);

    const r = await resolver.resolveFromHost('admin.translog.test');
    expect(r).toEqual({
      tenantId: PLATFORM_TENANT_ID,
      slug:     'platform',
      source:   'host',
      hostname: 'admin.translog.test',
    });
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('ne fallback PAS sur tenants.slug=admin même si admin existait en DB', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);
    // Admin est réservé → la stratégie 3 est skippée
    const r = await resolver.resolveFromHost('admin.translog.test');
    expect(r!.tenantId).toBe(PLATFORM_TENANT_ID);
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  // ─── Stratégie 3 : fallback slug ──────────────────────────────────────────

  it('fallback slug direct quand pas de TenantDomain', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-b-id', slug: 'tenantb',
    });

    const r = await resolver.resolveFromHost('tenantb.translog.test');
    expect(r).toEqual({
      tenantId: 'tenant-b-id',
      slug:     'tenantb',
      source:   'host',
      hostname: 'tenantb.translog.test',
    });
    expect(mockPrisma.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: 'tenantb' } });
  });

  it('retourne null si fallback slug ne matche pas non plus', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    const r = await resolver.resolveFromHost('ghost.translog.test');
    expect(r).toBeNull();
  });

  it('retourne null pour un host externe (non plateforme)', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);

    const r = await resolver.resolveFromHost('evil.com');
    expect(r).toBeNull();
    // Aucune lookup en DB pour les hosts non-plateforme non-mappés
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  // ─── Normalisation input ──────────────────────────────────────────────────

  it('lowercase et strippe le port avant lookup', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue({
      tenantId: 'x', verifiedAt: new Date(), isPrimary: true, tenant: { slug: 'x' },
      hostname: 'x.translog.test',
    });

    await resolver.resolveFromHost('X.TRANSLOG.TEST:443');
    expect(mockDomainRepo.findByHostname).toHaveBeenCalledWith('x.translog.test');
  });

  it('retourne null pour hostname vide', async () => {
    const r = await resolver.resolveFromHost('');
    expect(r).toBeNull();
    expect(mockDomainRepo.findByHostname).not.toHaveBeenCalled();
  });

  // ─── Sous-domaine réservé → pas de fallback ───────────────────────────────

  it('ignore le fallback pour un sous-domaine réservé', async () => {
    mockDomainRepo.findByHostname.mockResolvedValue(null);

    const r = await resolver.resolveFromHost('api.translog.test');
    expect(r).toBeNull();
    expect(mockPrisma.tenant.findUnique).not.toHaveBeenCalled();
  });
});
