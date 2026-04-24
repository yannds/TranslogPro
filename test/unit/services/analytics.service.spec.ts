/**
 * AnalyticsService — Tests unitaires (getKpis mobile + tenant isolation).
 */

import { AnalyticsService } from '@modules/analytics/analytics.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-ana-001';
const AGENCY = 'agency-01';

function makePrisma(counts: {
  tickets?:      number;
  parcels?:      number;
  openIncidents?: number;
  openRegisters?: number;
  discrepancies?: number;
} = {}) {
  const seq = [
    counts.tickets       ?? 0,
    counts.parcels       ?? 0,
    counts.openIncidents ?? 0,
    counts.openRegisters ?? 0,
    counts.discrepancies ?? 0,
  ];
  // Compteur partagé pour alimenter chaque `count` dans l'ordre
  // dans lequel getKpis les appelle (ticket, parcel, incident, register, discrepancy).
  let idx = 0;
  const nextCount = jest.fn().mockImplementation(() => Promise.resolve(seq[idx++]));
  return {
    ticket:       { count: nextCount },
    parcel:       { count: nextCount },
    incident:     { count: nextCount },
    cashRegister: { count: nextCount },
  } as unknown as jest.Mocked<PrismaService>;
}

describe('AnalyticsService.getKpis', () => {
  it('retourne les 5 compteurs KPI du jour', async () => {
    const prisma = makePrisma({ tickets: 12, parcels: 4, openIncidents: 1, openRegisters: 2, discrepancies: 0 });
    const svc = new AnalyticsService(prisma);
    const k = await svc.getKpis(TENANT);
    expect(k).toEqual({
      ticketsToday: 12, parcelsToday: 4, openIncidents: 1, openRegisters: 2, discrepancyCount: 0,
    });
  });

  it('filtre par tenantId sur chaque WHERE (tenant isolation)', async () => {
    const prisma = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.getKpis(TENANT);
    // Chaque count reçoit un where.tenantId = TENANT
    const calls = (prisma.ticket.count as jest.Mock).mock.calls;
    for (const call of calls) {
      expect(call[0].where.tenantId).toBe(TENANT);
    }
  });

  it('filtre par agencyId si fourni (scope agency)', async () => {
    const prisma = makePrisma();
    const svc = new AnalyticsService(prisma);
    await svc.getKpis(TENANT, AGENCY);
    const ticketCall = (prisma.ticket.count as jest.Mock).mock.calls[0][0];
    expect(ticketCall.where.agencyId).toBe(AGENCY);
  });
});

// ── Resilience des endpoints IA (pas de 5xx sur erreur Prisma) ────────────────
describe('AnalyticsService — AI endpoints resilience', () => {
  function makeFailingPrisma(where: 'tripAnalytics' | 'bus') {
    const fail = (msg: string) => jest.fn().mockRejectedValue(new Error(msg));
    return {
      tripAnalytics: { groupBy: where === 'tripAnalytics'
        ? fail('boom groupBy')
        : jest.fn().mockResolvedValue([
            { busId: 'b1', _avg: { avgFillRate: 0.4, avgNetMargin: -10 }, _sum: { tripCount: 10 } },
          ]) },
      bus:   { findMany: where === 'bus' ? fail('boom findMany') : jest.fn().mockResolvedValue([]) },
      route: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as jest.Mocked<PrismaService>;
  }

  it('getAiFleet retourne [] si tripAnalytics.groupBy throw (ne propage PAS en 5xx)', async () => {
    const svc = new AnalyticsService(makeFailingPrisma('tripAnalytics'));
    const result = await svc.getAiFleet('tenant-x');
    expect(result).toEqual([]);
  });

  it('getAiFleet retourne [] si bus.findMany throw (ne propage PAS en 5xx)', async () => {
    const svc = new AnalyticsService(makeFailingPrisma('bus'));
    const result = await svc.getAiFleet('tenant-x');
    expect(result).toEqual([]);
  });

  it('getAiRoutes retourne [] si tripAnalytics.groupBy throw', async () => {
    const prisma = {
      tripAnalytics: { groupBy: jest.fn().mockRejectedValue(new Error('db down')) },
      route:         { findMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const svc = new AnalyticsService(prisma);
    const result = await svc.getAiRoutes('tenant-x');
    expect(result).toEqual([]);
  });

  it('getAiPricing retourne [] si tripAnalytics.groupBy throw', async () => {
    const prisma = {
      tripAnalytics: { groupBy: jest.fn().mockRejectedValue(new Error('timeout')) },
      route:         { findMany: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const svc = new AnalyticsService(prisma);
    const result = await svc.getAiPricing('tenant-x');
    expect(result).toEqual([]);
  });
});
