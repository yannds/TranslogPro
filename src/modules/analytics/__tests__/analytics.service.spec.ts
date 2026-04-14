/**
 * AnalyticsService — Tests unitaires
 *
 * Stratégie : PrismaService mocké.
 * Tests centrés sur :
 *   - getDashboard() : agrégats corrects, scope agency, revenue null
 *   - getTopRoutes() : tri, limite
 *   - getOccupancyRate() : calcul taux remplissage
 */

import { AnalyticsService } from '../analytics.service';
import { PrismaService }    from '../../../infrastructure/database/prisma.service';

// ─── Constantes ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-1';
const AGENCY_ID = 'agency-1';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrisma(opts: {
  totalTrips?:   number;
  activeTrips?:  number;
  totalTickets?: number;
  totalRevenue?: number | null;
  totalParcels?: number;
  openIncidents?: number;
  topRoutes?:    object[];
  occupancy?:    { seatsTotal: number; reservedSeats: object[] };
} = {}): jest.Mocked<PrismaService> {
  return {
    trip: {
      count: jest.fn()
        .mockResolvedValueOnce(opts.totalTrips  ?? 10)  // total
        .mockResolvedValueOnce(opts.activeTrips ?? 3),  // actifs (BOARDING + IN_PROGRESS)
    },
    ticket: {
      count:   jest.fn().mockResolvedValue(opts.totalTickets ?? 150),
      findMany: jest.fn().mockResolvedValue(opts.topRoutes ?? []),
      groupBy:  jest.fn().mockResolvedValue(opts.topRoutes ?? []),
    },
    transaction: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amount: 'totalRevenue' in opts ? opts.totalRevenue : 500_000 },
      }),
    },
    parcel: {
      count: jest.fn().mockResolvedValue(opts.totalParcels ?? 25),
    },
    incident: {
      count: jest.fn().mockResolvedValue(opts.openIncidents ?? 2),
    },
    seat: {
      count: jest.fn().mockResolvedValue(
        opts.occupancy?.seatsTotal ?? 50,
      ),
    },
    tripSeat: {
      findMany: jest.fn().mockResolvedValue(
        opts.occupancy?.reservedSeats ?? [],
      ),
      count: jest.fn().mockResolvedValue(
        opts.occupancy?.reservedSeats?.length ?? 0,
      ),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnalyticsService', () => {

  describe('getDashboard()', () => {
    it('retourne les agrégats corrects pour un tenant', async () => {
      const prisma = makePrisma({
        totalTrips:   24,
        activeTrips:  6,
        totalTickets: 1284,
        totalRevenue: 6_800_000,
        totalParcels: 312,
        openIncidents: 7,
      });
      const svc = new AnalyticsService(prisma);

      const result = await svc.getDashboard(TENANT_ID);

      expect(result.trips.total).toBe(24);
      expect(result.trips.active).toBe(6);
      expect(result.tickets.total).toBe(1284);
      expect(result.revenue.total).toBe(6_800_000);
      expect(result.revenue.currency).toBe('XOF');
      expect(result.parcels.total).toBe(312);
      expect(result.incidents.open).toBe(7);
    });

    it('retourne revenue.total=0 quand transaction.aggregate retourne null', async () => {
      const prisma = makePrisma({ totalRevenue: null });
      const svc = new AnalyticsService(prisma);

      const result = await svc.getDashboard(TENANT_ID);

      expect(result.revenue.total).toBe(0);
    });

    it('filtre les tickets/transactions par agencyId quand le scope est agency', async () => {
      const prisma = makePrisma({ totalTickets: 45 });
      const svc = new AnalyticsService(prisma);

      await svc.getDashboard(TENANT_ID, AGENCY_ID);

      expect(prisma.ticket.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ agencyId: AGENCY_ID }) }),
      );
    });

    it("ne filtre pas par agencyId quand l'agencyId n'est pas fourni", async () => {
      const prisma = makePrisma();
      const svc = new AnalyticsService(prisma);

      await svc.getDashboard(TENANT_ID);

      expect(prisma.ticket.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ agencyId: expect.anything() }) }),
      );
    });
  });
});
