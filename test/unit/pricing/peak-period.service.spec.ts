import { PeakPeriodService } from '../../../src/modules/pricing/peak-period.service';

describe('PeakPeriodService.resolveDemandFactor (Sprint 5)', () => {
  const mkPrisma = (periods: any[]) => ({
    peakPeriod: {
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        const at = where.startDate?.lte as Date;
        return periods.filter(p =>
          (!where.enabled || p.enabled) &&
          p.startDate <= at && p.endDate >= at,
        );
      }),
    },
  }) as any;

  it('retourne factor 1.0 quand aucune période active', async () => {
    const svc = new PeakPeriodService(mkPrisma([]));
    const r = await svc.resolveDemandFactor('tenant-x', new Date('2026-05-15'));
    expect(r.factor).toBe(1);
    expect(r.periods).toHaveLength(0);
  });

  it('applique un facteur unique de majoration', async () => {
    const svc = new PeakPeriodService(mkPrisma([
      { code: 'CHRISTMAS_2026', label: 'Noël 2026', enabled: true,
        startDate: new Date('2026-12-20'), endDate: new Date('2026-12-27'),
        expectedDemandFactor: 1.4 },
    ]));
    const r = await svc.resolveDemandFactor('tenant-x', new Date('2026-12-23'));
    expect(r.factor).toBe(1.4);
    expect(r.periods).toEqual([{ code: 'CHRISTMAS_2026', label: 'Noël 2026', factor: 1.4 }]);
  });

  it('combine plusieurs périodes par produit (chevauchement)', async () => {
    const svc = new PeakPeriodService(mkPrisma([
      { code: 'A', label: 'A', enabled: true,
        startDate: new Date('2026-07-01'), endDate: new Date('2026-07-31'),
        expectedDemandFactor: 1.2 },
      { code: 'B', label: 'B', enabled: true,
        startDate: new Date('2026-07-10'), endDate: new Date('2026-07-20'),
        expectedDemandFactor: 1.1 },
    ]));
    const r = await svc.resolveDemandFactor('tenant-x', new Date('2026-07-15'));
    expect(r.factor).toBeCloseTo(1.32, 2); // 1.2 × 1.1
    expect(r.periods).toHaveLength(2);
  });

  it('accepte un facteur < 1 (creux saisonnier)', async () => {
    const svc = new PeakPeriodService(mkPrisma([
      { code: 'JANUARY_LULL', label: 'Creux janvier', enabled: true,
        startDate: new Date('2026-01-10'), endDate: new Date('2026-02-15'),
        expectedDemandFactor: 0.85 },
    ]));
    const r = await svc.resolveDemandFactor('tenant-x', new Date('2026-01-25'));
    expect(r.factor).toBe(0.85);
  });

  it('[sécurité] filtre par tenantId', async () => {
    const prisma = mkPrisma([]);
    const svc = new PeakPeriodService(prisma);
    await svc.resolveDemandFactor('tenant-abc', new Date('2026-04-20'));
    expect(prisma.peakPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-abc' }) }),
    );
  });

  it('valide expectedDemandFactor strictement', () => {
    const svc = new PeakPeriodService({} as any);
    const base = {
      code: 'TEST', label: 'Test',
      startDate: '2026-07-01', endDate: '2026-07-31',
    };
    expect(() => (svc as any).validate({ ...base, expectedDemandFactor: 0    })).toThrow();
    expect(() => (svc as any).validate({ ...base, expectedDemandFactor: -1   })).toThrow();
    expect(() => (svc as any).validate({ ...base, expectedDemandFactor: 10   })).toThrow();
    expect(() => (svc as any).validate({ ...base, expectedDemandFactor: 1.4  })).not.toThrow();
  });

  it('refuse endDate < startDate', () => {
    const svc = new PeakPeriodService({} as any);
    expect(() => (svc as any).validate({
      code: 'X', label: 'X',
      startDate: '2026-07-31', endDate: '2026-07-01',
      expectedDemandFactor: 1.2,
    })).toThrow();
  });
});
