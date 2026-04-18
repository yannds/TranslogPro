import { CustomerSegmentService } from '../../../src/modules/crm/customer-segment.service';

/**
 * Tests unitaires CustomerSegmentService — Phase 5.
 *
 * Couvre :
 *   - Règles pures computeSegments() (VIP, FREQUENT, NEW, DORMANT)
 *   - Préservation des segments manuels (CORPORATE, labels libres)
 *   - Idempotence (pas d'update si segments inchangés)
 *   - Isolation tenant (recomputeForTenant)
 */

describe('CustomerSegmentService', () => {
  let prismaMock: any;
  let service:    CustomerSegmentService;

  beforeEach(() => {
    prismaMock = {
      customer: {
        findFirst: jest.fn(),
        findMany:  jest.fn().mockResolvedValue([]),
        update:    jest.fn().mockResolvedValue({}),
      },
    };
    service = new CustomerSegmentService(prismaMock);
  });

  // ─── Règles pures ─────────────────────────────────────────────────────────
  describe('computeSegments() — règles pures', () => {
    const base = {
      totalTickets:    0,
      totalParcels:    0,
      totalSpentCents: 0n,
      firstSeenAt:     new Date(),
      lastSeenAt:      new Date(),
    };

    it('ajoute VIP si totalSpentCents >= 500 000', () => {
      const segs = service.computeSegments({ ...base, totalSpentCents: 500_000n });
      expect(segs).toContain('VIP');
    });

    it('n\'ajoute pas VIP en dessous du seuil', () => {
      const segs = service.computeSegments({ ...base, totalSpentCents: 499_999n });
      expect(segs).not.toContain('VIP');
    });

    it('ajoute FREQUENT si totalTickets + totalParcels >= 5', () => {
      expect(service.computeSegments({ ...base, totalTickets: 5 })).toContain('FREQUENT');
      expect(service.computeSegments({ ...base, totalTickets: 3, totalParcels: 2 })).toContain('FREQUENT');
      expect(service.computeSegments({ ...base, totalTickets: 2, totalParcels: 2 })).not.toContain('FREQUENT');
    });

    it('ajoute NEW si firstSeenAt < 30 jours', () => {
      const segs = service.computeSegments({
        ...base,
        firstSeenAt: new Date(Date.now() - 29 * 24 * 3600_000),
      });
      expect(segs).toContain('NEW');
    });

    it('n\'ajoute pas NEW au-delà de 30 jours', () => {
      const segs = service.computeSegments({
        ...base,
        firstSeenAt: new Date(Date.now() - 31 * 24 * 3600_000),
        lastSeenAt:  new Date(Date.now() - 31 * 24 * 3600_000),  // évite DORMANT trop
      });
      expect(segs).not.toContain('NEW');
    });

    it('ajoute DORMANT si lastSeenAt > 90 jours', () => {
      const segs = service.computeSegments({
        ...base,
        firstSeenAt: new Date(Date.now() - 200 * 24 * 3600_000),
        lastSeenAt:  new Date(Date.now() - 91 * 24 * 3600_000),
      });
      expect(segs).toContain('DORMANT');
    });

    it('combine plusieurs segments simultanément', () => {
      const segs = service.computeSegments({
        totalTickets:    10,
        totalParcels:    5,
        totalSpentCents: 1_000_000n,
        firstSeenAt:     new Date(Date.now() - 10 * 24 * 3600_000),
        lastSeenAt:      new Date(),
      });
      expect(segs).toContain('VIP');
      expect(segs).toContain('FREQUENT');
      expect(segs).toContain('NEW');
      expect(segs).not.toContain('DORMANT');
    });
  });

  // ─── recomputeForCustomer() ───────────────────────────────────────────────
  describe('recomputeForCustomer()', () => {
    it('préserve les segments manuels (CORPORATE, custom)', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1',
        totalTickets: 10, totalParcels: 0,
        totalSpentCents: 0n,
        firstSeenAt: new Date(), lastSeenAt: new Date(),
        segments: ['CORPORATE', 'VIP', 'PREMIUM_B2B'],   // VIP sera recalculé ; CORPORATE + PREMIUM_B2B manuels
      });

      const next = await service.recomputeForCustomer('T1', 'c1');

      // VIP enlevé (totalSpentCents=0), FREQUENT ajouté, CORPORATE + PREMIUM_B2B préservés, NEW ajouté
      expect(next).toContain('CORPORATE');
      expect(next).toContain('PREMIUM_B2B');
      expect(next).toContain('FREQUENT');
      expect(next).not.toContain('VIP');
    });

    it('idempotent : pas d\'update si segments déjà corrects', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1',
        totalTickets: 5, totalParcels: 0,
        totalSpentCents: 0n,
        firstSeenAt: new Date(Date.now() - 100 * 24 * 3600_000),
        lastSeenAt:  new Date(),
        segments: ['FREQUENT'],
      });

      await service.recomputeForCustomer('T1', 'c1');
      expect(prismaMock.customer.update).not.toHaveBeenCalled();
    });

    it('isolation tenant : lookup inclut tenantId + deletedAt:null', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);

      await service.recomputeForCustomer('T1', 'c1');

      const call = prismaMock.customer.findFirst.mock.calls[0][0];
      expect(call.where.tenantId).toBe('T1');
      expect(call.where.deletedAt).toBeNull();
    });

    it('retourne [] si Customer introuvable (silencieux)', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);
      const out = await service.recomputeForCustomer('T1', 'c1');
      expect(out).toEqual([]);
    });
  });

  // ─── recomputeForTenant() ─────────────────────────────────────────────────
  describe('recomputeForTenant()', () => {
    it('scan tous les Customers du tenant, update seulement ceux dont les segments changent', async () => {
      prismaMock.customer.findMany.mockResolvedValueOnce([
        {   // doit être updaté : passe de [] à [FREQUENT, NEW]
          id: 'c1', totalTickets: 5, totalParcels: 0,
          totalSpentCents: 0n,
          firstSeenAt: new Date(), lastSeenAt: new Date(),
          segments: [],
        },
        {   // rien à changer
          id: 'c2', totalTickets: 0, totalParcels: 0,
          totalSpentCents: 0n,
          firstSeenAt: new Date(Date.now() - 200 * 24 * 3600_000),
          lastSeenAt:  new Date(Date.now() - 200 * 24 * 3600_000),
          segments: ['DORMANT'],
        },
      ]);

      const res = await service.recomputeForTenant('T1');

      expect(res.scanned).toBe(2);
      expect(res.updated).toBe(1);
      expect(prismaMock.customer.update).toHaveBeenCalledTimes(1);
    });
  });
});
