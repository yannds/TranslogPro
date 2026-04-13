/**
 * ProfitabilityService — Tests unitaires
 *
 * Stratégie : mock PrismaService — pas de DB réelle.
 * Vérifie l'orchestration : idempotence, chargement profil, délégation au moteur,
 * persistance snapshot, et agrégation du dashboard.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProfitabilityService } from '../../../src/modules/pricing/profitability.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const T  = 'tenant-001';
const TID = 'trip-001';
const BID = 'bus-001';

const MOCK_PROFILE = {
  id:                      'cp-01',
  tenantId:                T,
  busId:                   BID,
  fuelConsumptionPer100Km: 28,
  fuelPricePerLiter:       1.45,
  adBlueCostPerLiter:      0.18,
  adBlueRatioFuel:         0.05,
  maintenanceCostPerKm:    0.05,
  stationFeePerDeparture:  500,
  driverAllowancePerTrip:  1500,
  tollFeesPerTrip:         800,
  driverMonthlySalary:     350_000,
  annualInsuranceCost:     1_200_000,
  monthlyAgencyFees:       50_000,
  purchasePrice:           45_000_000,
  depreciationYears:       10,
  residualValue:           5_000_000,
  avgTripsPerMonth:        30,
  updatedAt:               new Date(),
};

const MOCK_TRIP = {
  id:      TID,
  tenantId: T,
  busId:   BID,
  status:  'COMPLETED',
  bus: {
    id: BID,
    capacity: 50,
    costProfile: MOCK_PROFILE,
  },
  route: {
    id:          'route-01',
    distanceKm:  450,
    basePrice:   2000,
  },
};

const MOCK_SNAPSHOT = {
  id:               'snap-01',
  tenantId:         T,
  tripId:           TID,
  profitabilityTag: 'PROFITABLE',
  netMargin:        21_000,
  totalCost:        56_000,
  totalRevenue:     80_000,
  operationalMargin: 52_000,
  fillRate:         0.76,
  computedAt:       new Date(),
};

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, unknown> = {}): jest.Mocked<PrismaService> {
  return {
    bus: {
      findFirst: jest.fn().mockResolvedValue({ id: BID, tenantId: T }),
    },
    busCostProfile: {
      upsert:    jest.fn().mockResolvedValue(MOCK_PROFILE),
      findFirst: jest.fn().mockResolvedValue(MOCK_PROFILE),
    },
    tripCostSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue(MOCK_SNAPSHOT),
      findMany:   jest.fn().mockResolvedValue([MOCK_SNAPSHOT]),
    },
    trip: {
      findFirst: jest.fn().mockResolvedValue(MOCK_TRIP),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(null), // → DEFAULT_BUSINESS_CONSTANTS
    },
    ticket: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { pricePaid: 75_000 }, _count: { id: 38 } }),
      count:     jest.fn().mockResolvedValue(38),
    },
    transaction: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 5_000 } }),
    },
    ...overrides,
  } as unknown as jest.Mocked<PrismaService>;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProfitabilityService', () => {
  let service: ProfitabilityService;
  let prisma:  jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma  = makePrisma();
    service = new ProfitabilityService(prisma);
  });

  // ── upsertCostProfile() ───────────────────────────────────────────────────

  describe('upsertCostProfile()', () => {
    it('appelle busCostProfile.upsert() avec les bons champs', async () => {
      await service.upsertCostProfile(T, BID, {
        fuelConsumptionPer100Km: 28,
        fuelPricePerLiter:       1.45,
        driverMonthlySalary:     350_000,
        annualInsuranceCost:     1_200_000,
        monthlyAgencyFees:       50_000,
        purchasePrice:           45_000_000,
      });
      expect(prisma.busCostProfile.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { busId: BID },
        }),
      );
    });

    it('lève NotFoundException si bus introuvable', async () => {
      (prisma.bus.findFirst as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        service.upsertCostProfile(T, 'unknown-bus', {
          fuelConsumptionPer100Km: 28,
          fuelPricePerLiter: 1.45,
          driverMonthlySalary: 350_000,
          annualInsuranceCost: 1_200_000,
          monthlyAgencyFees: 50_000,
          purchasePrice: 45_000_000,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('applique les champs adBlue et maintenanceCostPerKm avec leurs défauts', async () => {
      await service.upsertCostProfile(T, BID, {
        fuelConsumptionPer100Km: 28,
        fuelPricePerLiter: 1.45,
        driverMonthlySalary: 350_000,
        annualInsuranceCost: 1_200_000,
        monthlyAgencyFees: 50_000,
        purchasePrice: 45_000_000,
      });
      const call = (prisma.busCostProfile.upsert as jest.Mock).mock.calls[0][0];
      expect(call.create.adBlueCostPerLiter).toBe(0.18);
      expect(call.create.adBlueRatioFuel).toBe(0.05);
      expect(call.create.maintenanceCostPerKm).toBe(0.05);
    });
  });

  // ── computeAndSnapshot() ─────────────────────────────────────────────────

  describe('computeAndSnapshot()', () => {
    it('retourne le snapshot existant sans recalculer (idempotence)', async () => {
      (prisma.tripCostSnapshot.findUnique as jest.Mock).mockResolvedValueOnce(MOCK_SNAPSHOT);
      const result = await service.computeAndSnapshot(T, TID);
      expect(result).toBe(MOCK_SNAPSHOT);
      expect(prisma.trip.findFirst).not.toHaveBeenCalled();
    });

    it('lève NotFoundException si trip introuvable', async () => {
      (prisma.trip.findFirst as jest.Mock).mockResolvedValueOnce(null);
      await expect(service.computeAndSnapshot(T, 'unknown-trip')).rejects.toThrow(NotFoundException);
    });

    it('lève BadRequestException si bus n\'a pas de BusCostProfile', async () => {
      (prisma.trip.findFirst as jest.Mock).mockResolvedValueOnce({
        ...MOCK_TRIP,
        bus: { ...MOCK_TRIP.bus, costProfile: null },
      });
      await expect(service.computeAndSnapshot(T, TID)).rejects.toThrow(BadRequestException);
    });

    it('crée le snapshot avec profitabilityTag et netMargin', async () => {
      const result = await service.computeAndSnapshot(T, TID);
      expect(result.profitabilityTag).toBeDefined();
      expect(['PROFITABLE', 'BREAK_EVEN', 'DEFICIT']).toContain(result.profitabilityTag);
    });

    it('appelle ticket.aggregate et transaction.aggregate pour les revenus', async () => {
      await service.computeAndSnapshot(T, TID);
      expect(prisma.ticket.aggregate).toHaveBeenCalled();
      expect(prisma.transaction.aggregate).toHaveBeenCalled();
    });

    it('utilise DEFAULT_BUSINESS_CONSTANTS quand TenantBusinessConfig est null', async () => {
      // tenantBusinessConfig.findUnique retourne null → pas d'erreur
      const result = await service.computeAndSnapshot(T, TID);
      expect(result).toBeDefined();
    });

    it('appelle tripCostSnapshot.create() une seule fois', async () => {
      await service.computeAndSnapshot(T, TID);
      expect(prisma.tripCostSnapshot.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── getProfitabilitySummary() ─────────────────────────────────────────────

  describe('getProfitabilitySummary()', () => {
    it('retourne totalRevenue, totalCost et totalNetMargin agrégés', async () => {
      const from = new Date('2026-01-01');
      const to   = new Date('2026-12-31');
      const summary = await service.getProfitabilitySummary(T, from, to);
      expect(summary.tripCount).toBe(1);
      expect(summary.totalRevenue).toBe(MOCK_SNAPSHOT.totalRevenue);
    });

    it('retourne byTag avec le count par profitabilityTag', async () => {
      const summary = await service.getProfitabilitySummary(T, new Date(), new Date());
      expect(summary.byTag).toHaveProperty('PROFITABLE');
    });

    it('retourne avgFillRate = 0 si aucun snapshot', async () => {
      (prisma.tripCostSnapshot.findMany as jest.Mock).mockResolvedValueOnce([]);
      const summary = await service.getProfitabilitySummary(T, new Date(), new Date());
      expect(summary.tripCount).toBe(0);
      expect(summary.avgFillRate).toBe(0);
    });

    it('totalOperationalMargin est présent dans le résumé', async () => {
      const summary = await service.getProfitabilitySummary(T, new Date(), new Date());
      expect(summary).toHaveProperty('totalOperationalMargin');
    });
  });
});
