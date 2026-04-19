/**
 * Security Test — Public Reporter Host Controller (Sprint 4 citoyen).
 *
 * Objectifs :
 *   1. L'endpoint POST /api/public/report DOIT rejeter toute requête dont
 *      `req.resolvedHostTenant` est absent (domaine inconnu) — BadRequestException.
 *   2. Quand un tenant est résolu, le service est appelé avec CE tenantId
 *      (pas celui du body, ni d'aucune autre source) — anti-smuggling.
 *   3. GET /api/public/report/tenant-info ne fuite que { tenantId, slug }
 *      (zéro données sensibles — pas d'email, pas de secrets, etc.).
 */

import { BadRequestException } from '@nestjs/common';
import { PublicReporterHostController } from '@modules/public-reporter/public-reporter.controller';
import type { PublicReporterService } from '@modules/public-reporter/public-reporter.service';

function makeService(): jest.Mocked<PublicReporterService> {
  return {
    submit:           jest.fn().mockResolvedValue({ id: 'r-1', status: 'PENDING', verificationScore: 42 }),
    listForDispatch:  jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<PublicReporterService>;
}

function makeRequest(opts: { tenantId?: string; slug?: string; ip?: string } = {}) {
  return {
    resolvedHostTenant: opts.tenantId ? { tenantId: opts.tenantId, slug: opts.slug ?? null } : undefined,
    headers: { 'x-forwarded-for': opts.ip ?? '1.2.3.4' },
    socket:  { remoteAddress: '127.0.0.1' },
  } as any;
}

describe('[SECURITY] PublicReporterHostController — résolution tenant via host', () => {
  it('POST /report — rejette avec 400 si host non mappé à un tenant', async () => {
    const service = makeService();
    const ctrl = new PublicReporterHostController(service);
    expect(() => ctrl.submit({
      plateOrParkNumber: 'BZV-1',
      type: 'DANGEROUS_DRIVING',
      description: 'x',
    } as any, makeRequest({}))).toThrow(BadRequestException);
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('POST /report — le service reçoit UNIQUEMENT le tenantId résolu par le host', async () => {
    const service = makeService();
    const ctrl = new PublicReporterHostController(service);

    const trueTenantId = 'tenant-from-host';
    const req = makeRequest({ tenantId: trueTenantId, slug: 'abc' });

    // Tenter de forcer un autre tenantId via body → doit être IGNORÉ
    // (le DTO ne contient pas tenantId ; le service prend celui du host).
    await ctrl.submit({
      plateOrParkNumber: 'BZV-1',
      type: 'DANGEROUS_DRIVING',
      description: 'description suffisamment longue',
    } as any, req);

    expect(service.submit).toHaveBeenCalledWith(
      trueTenantId,
      expect.objectContaining({ plateOrParkNumber: 'BZV-1' }),
      expect.any(String),
    );
  });

  it('GET /tenant-info — retourne seulement { tenantId, slug } (zéro leak)', async () => {
    const service = makeService();
    const ctrl = new PublicReporterHostController(service);
    const info = ctrl.tenantInfo(makeRequest({ tenantId: 't-1', slug: 'abc' }));
    expect(info).toEqual({ tenantId: 't-1', slug: 'abc' });
    // Pas de clés sensibles exposées
    expect(Object.keys(info)).toEqual(expect.arrayContaining(['tenantId', 'slug']));
    expect(Object.keys(info)).toHaveLength(2);
  });

  it('GET /tenant-info — rejette 400 si host inconnu', () => {
    const service = makeService();
    const ctrl = new PublicReporterHostController(service);
    expect(() => ctrl.tenantInfo(makeRequest({}))).toThrow(BadRequestException);
  });
});
