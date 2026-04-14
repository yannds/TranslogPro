/**
 * ProfitabilityService — Tests unitaires
 *
 * Stratégie : PrismaService mocké.
 * Tests centrés sur :
 *   - getProfitabilitySummary() : agrégats, globalNetMarginRate, byTag, période vide
 *   - upsertCostProfile()       : bus introuvable → NotFoundException
 */

import { NotFoundException } from '@nestjs/common';
import { ProfitabilityService } from '../profitability.service';
import { PrismaService }        from '../../../infrastructure/database/prisma.service';

// ─── Constantes ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const BUS_ID    = 'bus-001';
const FROM      = new Date('2026-01-01');
const TO        = new Date('2026-01-31');

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrisma(opts: {
  bus?:       object | null;
  snapshots?: object[];
} = {}): jest.Mocked<PrismaService> {
  const bus       = 'bus' in opts ? opts.bus : { id: BUS_ID, tenantId: TENANT_ID };
  const snapshots = opts.snapshots ?? [];

  return {
    bus: {
      findFirst: jest.fn().mockResolvedValue(bus),
    },
    tripCostSnapshot: {
      findMany: jest.fn().mockResolvedValue(snapshots),
      create:   jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'snap-1', ...data })),
    },
    tenantBusinessConfig: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    busCostProfile: {
      upsert: jest.fn().mockResolvedValue({ id: 'profile-1' }),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

// Snapshots de test
const SNAPSHOTS = [
  {
    id: 's1', profitabilityTag: 'PROFITABLE',
    totalRevenue: 800_000, totalCost: 600_000,
    netMargin: 200_000, operationalMargin: 250_000, fillRate: 0.9,
  },
  {
    id: 's2', profitabilityTag: 'BREAK_EVEN',
    totalRevenue: 500_000, totalCost: 500_000,
    netMargin: 0, operationalMargin: 50_000, fillRate: 0.6,
  },
  {
    id: 's3', profitabilityTag: 'PROFITABLE',
    totalRevenue: 700_000, totalCost: 550_000,
    netMargin: 150_000, operationalMargin: 180_000, fillRate: 0.8,
  },
  {
    id: 's4', profitabilityTag: 'UNPROFITABLE',
    totalRevenue: 300_000, totalCost: 450_000,
    netMargin: -150_000, operationalMargin: -80_000, fillRate: 0.35,
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProfitabilityService', () => {

  describe('getProfitabilitySummary()', () => {
    it('retourne les agrégats corrects sur une période avec données', async () => {
      const prisma = makePrisma({ snapshots: SNAPSHOTS });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      expect(result.tripCount).toBe(4);
      expect(result.totalRevenue).toBe(800_000 + 500_000 + 700_000 + 300_000);
      expect(result.totalCost).toBe(600_000 + 500_000 + 550_000 + 450_000);
      expect(result.totalNetMargin).toBe(200_000 + 0 + 150_000 + (-150_000));  // 200 000
      expect(result.avgFillRate).toBeCloseTo((0.9 + 0.6 + 0.8 + 0.35) / 4);
    });

    it('calcule globalNetMarginRate = totalNetMargin / totalCost', async () => {
      const prisma = makePrisma({ snapshots: SNAPSHOTS });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      const expectedRate = result.totalNetMargin / result.totalCost;
      expect(result.globalNetMarginRate).toBeCloseTo(expectedRate);
    });

    it('retourne globalNetMarginRate=0 quand totalCost=0', async () => {
      const prisma = makePrisma({ snapshots: [] });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      expect(result.globalNetMarginRate).toBe(0);
    });

    it('agrège correctement les counts par tag', async () => {
      const prisma = makePrisma({ snapshots: SNAPSHOTS });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      expect(result.byTag['PROFITABLE']).toBe(2);
      expect(result.byTag['BREAK_EVEN']).toBe(1);
      expect(result.byTag['UNPROFITABLE']).toBe(1);
    });

    it('retourne zéros et byTag vide quand aucun snapshot sur la période', async () => {
      const prisma = makePrisma({ snapshots: [] });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      expect(result.tripCount).toBe(0);
      expect(result.totalRevenue).toBe(0);
      expect(result.avgFillRate).toBe(0);
      expect(result.byTag).toEqual({});
    });

    it('retourne la période passée en paramètre', async () => {
      const prisma = makePrisma({ snapshots: [] });
      const svc    = new ProfitabilityService(prisma);

      const result = await svc.getProfitabilitySummary(TENANT_ID, FROM, TO);

      expect(result.period.from).toEqual(FROM);
      expect(result.period.to).toEqual(TO);
    });
  });

  describe('upsertCostProfile()', () => {
    it('lance NotFoundException si le bus est introuvable', async () => {
      const prisma = makePrisma({ bus: null });
      const svc    = new ProfitabilityService(prisma);

      await expect(
        svc.upsertCostProfile(TENANT_ID, BUS_ID, {
          fuelConsumptionPer100Km: 30,
          fuelPricePerLiter:       700,
          driverMonthlySalary:     150_000,
          annualInsuranceCost:     500_000,
          monthlyAgencyFees:       20_000,
          purchasePrice:           25_000_000,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
