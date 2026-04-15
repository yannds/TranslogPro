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

  // ─── getCustomerSegmentation() ─────────────────────────────────────────────
  // Segmentation par activité (has_ticket / has_parcel) — pas par rôle.

  describe('getCustomerSegmentation()', () => {
    function makeSegPrisma(opts: {
      totalCustomers: number;
      ticketBuyers:   string[];   // distinct passengerId
      parcelSenders:  (string | null)[]; // distinct senderId (peut contenir null si DB historique)
    }): jest.Mocked<PrismaService> {
      return {
        user: {
          count: jest.fn().mockResolvedValue(opts.totalCustomers),
        },
        ticket: {
          findMany: jest.fn().mockResolvedValue(opts.ticketBuyers.map(passengerId => ({ passengerId }))),
        },
        parcel: {
          findMany: jest.fn().mockResolvedValue(opts.parcelSenders.map(senderId => ({ senderId }))),
        },
      } as unknown as jest.Mocked<PrismaService>;
    }

    it('compte total CUSTOMER + filtre userType=CUSTOMER', async () => {
      const prisma = makeSegPrisma({ totalCustomers: 10, ticketBuyers: [], parcelSenders: [] });
      const svc    = new AnalyticsService(prisma);
      await svc.getCustomerSegmentation(TENANT_ID);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { tenantId: TENANT_ID, userType: 'CUSTOMER' },
      });
    });

    it("calcule travelersOnly = ticketBuyers \u00ad both", async () => {
      const prisma = makeSegPrisma({
        totalCustomers: 100,
        ticketBuyers:   ['u1', 'u2', 'u3'],     // 3 voyageurs
        parcelSenders:  ['u3', 'u4'],            // 2 expéditeurs (u3 fait les deux)
      });
      const svc    = new AnalyticsService(prisma);
      const r      = await svc.getCustomerSegmentation(TENANT_ID);
      expect(r.both).toBe(1);             // u3
      expect(r.travelersOnly).toBe(2);    // u1, u2
      expect(r.shippersOnly).toBe(1);     // u4
      expect(r.active).toBe(4);           // u1, u2, u3, u4
      expect(r.inactive).toBe(96);        // 100 - 4
      expect(r.total).toBe(100);
    });

    it('total inactive = max(0, total - active) — jamais négatif', async () => {
      const prisma = makeSegPrisma({
        totalCustomers: 2,
        ticketBuyers:   ['u1', 'u2', 'u3'],   // plus de buyers que de CUSTOMER (cas legacy)
        parcelSenders:  [],
      });
      const svc = new AnalyticsService(prisma);
      const r   = await svc.getCustomerSegmentation(TENANT_ID);
      expect(r.inactive).toBe(0);
    });

    it('ignore les senderId null (parcels historiques sans owner)', async () => {
      const prisma = makeSegPrisma({
        totalCustomers: 5,
        ticketBuyers:   ['u1'],
        parcelSenders:  [null, 'u2', null],
      });
      const svc = new AnalyticsService(prisma);
      const r   = await svc.getCustomerSegmentation(TENANT_ID);
      expect(r.shippersOnly).toBe(1);  // u2 uniquement
      expect(r.both).toBe(0);
    });

    it('utilise distinct: passengerId / senderId pour limiter le payload Prisma', async () => {
      const prisma = makeSegPrisma({ totalCustomers: 0, ticketBuyers: [], parcelSenders: [] });
      const svc    = new AnalyticsService(prisma);
      await svc.getCustomerSegmentation(TENANT_ID);
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['passengerId'] }),
      );
      expect(prisma.parcel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['senderId'] }),
      );
    });
  });
});
