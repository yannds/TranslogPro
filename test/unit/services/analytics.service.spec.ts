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

// ── Analytics board — séries temporelles + breakdowns ────────────────────────
describe('AnalyticsService.getAnalyticsBoard', () => {
  function makeBoardPrisma(opts: {
    tenantCurrency?: string;
    txPeriod?:       any[];
    txPrev?:         number;
    tickets?:        any[];
    ticketsPrev?:    number;
    parcels?:        any[];
    parcelsPrev?:    number;
    fillRate?:       number;
  } = {}) {
    return {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ currency: opts.tenantCurrency ?? 'XAF' }),
      },
      transaction: {
        findMany:  jest.fn().mockResolvedValue(opts.txPeriod ?? []),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.txPrev ?? 0 } }),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue(opts.tickets ?? []),
        count:    jest.fn().mockResolvedValue(opts.ticketsPrev ?? 0),
      },
      parcel: {
        findMany: jest.fn().mockResolvedValue(opts.parcels ?? []),
        count:    jest.fn().mockResolvedValue(opts.parcelsPrev ?? 0),
      },
      tripAnalytics: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { avgFillRate: opts.fillRate ?? 0 } }),
      },
    } as unknown as jest.Mocked<PrismaService>;
  }

  it('retourne la devise depuis Tenant.currency (jamais hardcodée)', async () => {
    const prisma = makeBoardPrisma({ tenantCurrency: 'XOF' });
    const svc = new AnalyticsService(prisma);
    const res = await svc.getAnalyticsBoard(TENANT, '7d');
    expect(res.currency).toBe('XOF');
  });

  it('retourne 7 buckets pour period=7d, 30 pour 30d, 12 pour 90d', async () => {
    const prisma = makeBoardPrisma();
    const svc = new AnalyticsService(prisma);
    const r7  = await svc.getAnalyticsBoard(TENANT, '7d');
    const r30 = await svc.getAnalyticsBoard(TENANT, '30d');
    const r90 = await svc.getAnalyticsBoard(TENANT, '90d');
    expect(r7.revenue).toHaveLength(7);
    expect(r30.revenue).toHaveLength(30);
    expect(r90.revenue).toHaveLength(12);
  });

  it('filtre chaque query par tenantId (tenant isolation)', async () => {
    const prisma = makeBoardPrisma();
    const svc = new AnalyticsService(prisma);
    await svc.getAnalyticsBoard(TENANT, '7d');

    const txFM  = (prisma.transaction.findMany as jest.Mock).mock.calls[0][0].where;
    const tixFM = (prisma.ticket.findMany     as jest.Mock).mock.calls[0][0].where;
    const parFM = (prisma.parcel.findMany     as jest.Mock).mock.calls[0][0].where;
    const trAgg = (prisma.tripAnalytics.aggregate as jest.Mock).mock.calls[0][0].where;

    expect(txFM.tenantId).toBe(TENANT);
    expect(tixFM.tenantId).toBe(TENANT);
    expect(parFM.tenantId).toBe(TENANT);
    expect(trAgg.tenantId).toBe(TENANT);
  });

  it('ticketsByChannel ventile guichet (agencyId !== null) vs en ligne', async () => {
    const prisma = makeBoardPrisma({
      tickets: [
        { agencyId: 'ag-1', boardingStation: { name: 'A' }, alightingStation: { name: 'B' } },
        { agencyId: 'ag-1', boardingStation: { name: 'A' }, alightingStation: { name: 'B' } },
        { agencyId: null,   boardingStation: { name: 'A' }, alightingStation: { name: 'B' } },
        { agencyId: null,   boardingStation: { name: 'A' }, alightingStation: { name: 'B' } },
      ],
    });
    const svc = new AnalyticsService(prisma);
    const res = await svc.getAnalyticsBoard(TENANT, '7d');
    expect(res.ticketsByChannel).toEqual([
      { label: 'Guichet',  value: 50 },
      { label: 'En ligne', value: 50 },
    ]);
  });

  it('parcelsByWeight bucketize <5kg, 5–20kg, 20–50kg, >50kg', async () => {
    const prisma = makeBoardPrisma({
      parcels: [{ weight: 2 }, { weight: 15 }, { weight: 40 }, { weight: 60 }],
    });
    const svc = new AnalyticsService(prisma);
    const res = await svc.getAnalyticsBoard(TENANT, '7d');
    expect(res.parcelsByWeight).toEqual([
      { label: '<5kg',    value: 25 },
      { label: '5–20kg',  value: 25 },
      { label: '20–50kg', value: 25 },
      { label: '>50kg',   value: 25 },
    ]);
  });

  it('miniKpis.caDelta positif si CA > période précédente', async () => {
    const now = new Date();
    const prisma = makeBoardPrisma({
      txPeriod: [
        { amount: 8_000, createdAt: now },
        { amount: 2_000, createdAt: now },
      ],
      txPrev: 5_000,
    });
    const svc = new AnalyticsService(prisma);
    const res = await svc.getAnalyticsBoard(TENANT, '7d');
    expect(res.miniKpis.caTotal).toBe(10_000);
    expect(res.miniKpis.caDelta).toBe(100); // (10000-5000)/5000 = 100%
  });

  it('retourne un payload vide safe si Prisma throw', async () => {
    const prisma = {
      tenant:        { findUnique: jest.fn().mockRejectedValue(new Error('db down')) },
      transaction:   { findMany: jest.fn(), aggregate: jest.fn() },
      ticket:        { findMany: jest.fn(), count: jest.fn() },
      parcel:        { findMany: jest.fn(), count: jest.fn() },
      tripAnalytics: { aggregate: jest.fn() },
    } as unknown as jest.Mocked<PrismaService>;
    const svc = new AnalyticsService(prisma);
    const res = await svc.getAnalyticsBoard(TENANT, '7d');
    expect(res.revenue).toEqual([]);
    expect(res.miniKpis.caTotal).toBe(0);
  });
});
