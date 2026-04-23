/**
 * Tests unit — TollPointService.
 *
 * Couvre :
 *   - CRUD simple avec scope tenant
 *   - Conflit unique (tenantId, name)
 *   - Validation coords
 *   - detectOnRoute : match proximité + déjà lié
 *   - attachDetected : insertion + décalage ordre
 *   - helpers purs haversineKm / distanceToSegmentKm
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  TollPointService, haversineKm, distanceToSegmentKm,
} from '../../../src/modules/toll-point/toll-point.service';

const TENANT = 't1';
const ROUTE  = 'r1';

function makePrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    tollPoint: {
      findMany:   jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn(),
      create:     jest.fn(),
      update:     jest.fn(),
      delete:     jest.fn().mockResolvedValue({}),
    },
    route: {
      findFirst: jest.fn(),
    },
    waypoint: {
      findMany:   jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create:     jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return prisma;
}

function makeSvc(prisma: any, platformCfg: any = { getNumber: async () => 2 }) {
  return new TollPointService(prisma, platformCfg as any);
}

// ─── Helpers purs ────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('retourne ~0 pour deux points identiques', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
  });
  it('~111 km pour 1° de latitude', () => {
    const d = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe('distanceToSegmentKm', () => {
  it('retourne distance=0 et cumKm=milieu si le point est pile au milieu du segment', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 }; // ~111 km est
    const p = { lat: 0, lng: 0.5 };
    const r = distanceToSegmentKm(p, a, 0, b, 100);
    expect(r.distKm).toBeLessThan(0.1);
    expect(r.cumKm).toBeCloseTo(50, 0);
  });
  it('clamp sur l\'extrémité si le point dépasse le segment', () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    const p = { lat: 0, lng: 2 }; // au-delà de b
    const r = distanceToSegmentKm(p, a, 0, b, 100);
    expect(r.cumKm).toBe(100); // clampé sur b
  });
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('TollPointService CRUD', () => {
  it('create : persiste avec defaults kind=PEAGE, direction=BOTH', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.create.mockResolvedValue({ id: 'tp1' });
    const svc = makeSvc(prisma);
    await svc.create(TENANT, {
      name: 'Lifoula',
      coordinates: { lat: -4.1, lng: 15.2 },
      tollCostXaf: 10000,
    });
    expect(prisma.tollPoint.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: TENANT, name: 'Lifoula', kind: 'PEAGE', direction: 'BOTH', tollCostXaf: 10000,
      }),
    }));
  });

  it('create : trim le nom', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.create.mockResolvedValue({});
    const svc = makeSvc(prisma);
    await svc.create(TENANT, {
      name: '  Mengo  ', coordinates: { lat: -4.68, lng: 11.94 }, tollCostXaf: 5000,
    });
    expect(prisma.tollPoint.create.mock.calls[0][0].data.name).toBe('Mengo');
  });

  it('create : rejette lat hors bornes', async () => {
    const svc = makeSvc(makePrisma());
    await expect(svc.create(TENANT, {
      name: 'X', coordinates: { lat: 999, lng: 0 }, tollCostXaf: 1,
    })).rejects.toThrow(BadRequestException);
  });

  it('create : rejette tollCostXaf négatif', async () => {
    const svc = makeSvc(makePrisma());
    await expect(svc.create(TENANT, {
      name: 'X', coordinates: { lat: 0, lng: 0 }, tollCostXaf: -1,
    })).rejects.toThrow(BadRequestException);
  });

  it('create : conflict P2002 → 409', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '5' }),
    );
    const svc = makeSvc(prisma);
    await expect(svc.create(TENANT, {
      name: 'Dup', coordinates: { lat: 0, lng: 0 }, tollCostXaf: 100,
    })).rejects.toThrow(ConflictException);
  });

  it('update : 404 si absent (avant écriture)', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.findFirst.mockResolvedValue(null);
    const svc = makeSvc(prisma);
    await expect(svc.update(TENANT, 'missing', { tollCostXaf: 500 }))
      .rejects.toThrow(NotFoundException);
  });

  it('findAll : scope tenant', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.findMany.mockResolvedValue([{ id: 'a' }]);
    const svc = makeSvc(prisma);
    await svc.findAll(TENANT);
    expect(prisma.tollPoint.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT },
    }));
  });

  it('findOne : filtre par tenantId (pas d\'accès cross-tenant)', async () => {
    const prisma = makePrisma();
    prisma.tollPoint.findFirst.mockResolvedValue(null);
    const svc = makeSvc(prisma);
    await expect(svc.findOne(TENANT, 'id1')).rejects.toThrow(NotFoundException);
    expect(prisma.tollPoint.findFirst).toHaveBeenCalledWith({
      where: { id: 'id1', tenantId: TENANT },
    });
  });
});

// ─── detectOnRoute ──────────────────────────────────────────────────────────

describe('TollPointService.detectOnRoute', () => {
  it('détecte un péage à < 2 km de la polyline', async () => {
    const prisma = makePrisma();
    // Route Brazza-Mindouli avec 1 waypoint intermédiaire (tous sur la même latitude)
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin:      { coordinates: { lat: 0, lng: 0 } },
      destination: { coordinates: { lat: 0, lng: 2 } }, // ~222 km de 0
      waypoints:   [],
    });
    // TollPoint à (0, 1) — pile sur la polyline
    prisma.tollPoint.findMany.mockResolvedValue([{
      id: 'tp-near', name: 'Péage Central',
      coordinates: { lat: 0, lng: 1 },
      kind: 'PEAGE', tollCostXaf: 10000, direction: 'BOTH',
    }]);
    const svc = makeSvc(prisma);

    const matches = await svc.detectOnRoute(TENANT, ROUTE);
    expect(matches).toHaveLength(1);
    expect(matches[0].tollPointId).toBe('tp-near');
    expect(matches[0].matchDistanceKm).toBeLessThan(0.1);
    expect(matches[0].alreadyLinked).toBe(false);
  });

  it('exclut les péages à > radius (2 km)', async () => {
    const prisma = makePrisma();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin:      { coordinates: { lat: 0, lng: 0 } },
      destination: { coordinates: { lat: 0, lng: 2 } },
      waypoints:   [],
    });
    prisma.tollPoint.findMany.mockResolvedValue([
      { id: 'tp-close', name: 'Close',
        coordinates: { lat: 0.01, lng: 1 }, // ~1.1 km au nord
        kind: 'PEAGE', tollCostXaf: 10000, direction: 'BOTH' },
      { id: 'tp-far',   name: 'Far',
        coordinates: { lat: 0.05, lng: 1 }, // ~5.5 km au nord
        kind: 'PEAGE', tollCostXaf: 5000, direction: 'BOTH' },
    ]);
    const svc = makeSvc(prisma);

    const matches = await svc.detectOnRoute(TENANT, ROUTE);
    expect(matches.map(m => m.tollPointId)).toEqual(['tp-close']);
  });

  it('marque alreadyLinked=true si le TollPoint est déjà un waypoint de la route', async () => {
    const prisma = makePrisma();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin:      { coordinates: { lat: 0, lng: 0 } },
      destination: { coordinates: { lat: 0, lng: 2 } },
      waypoints:   [
        // waypoint lié à tp-near
        { id: 'w1', order: 1, tollPointId: 'tp-near', distanceFromOriginKm: 100, station: null },
      ],
    });
    prisma.tollPoint.findMany.mockResolvedValue([{
      id: 'tp-near', name: 'Central',
      coordinates: { lat: 0, lng: 1 }, kind: 'PEAGE', tollCostXaf: 10000, direction: 'BOTH',
    }]);
    const svc = makeSvc(prisma);

    const matches = await svc.detectOnRoute(TENANT, ROUTE);
    expect(matches).toHaveLength(1);
    expect(matches[0].alreadyLinked).toBe(true);
  });

  it('throw si route sans coords origine/destination', async () => {
    const prisma = makePrisma();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin: { coordinates: null }, destination: { coordinates: { lat: 0, lng: 2 } }, waypoints: [],
    });
    const svc = makeSvc(prisma);
    await expect(svc.detectOnRoute(TENANT, ROUTE)).rejects.toThrow(BadRequestException);
  });
});

// ─── attachDetected ──────────────────────────────────────────────────────────

describe('TollPointService.attachDetected', () => {
  it('insère les TollPoints détectés, skip les déjà liés', async () => {
    const prisma = makePrisma();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin:      { coordinates: { lat: 0, lng: 0 } },
      destination: { coordinates: { lat: 0, lng: 2 } },
      waypoints: [],
    });
    prisma.tollPoint.findMany.mockResolvedValue([
      { id: 'tp1', name: 'Un', coordinates: { lat: 0, lng: 0.5 }, kind: 'PEAGE', tollCostXaf: 5000, direction: 'BOTH' },
      { id: 'tp2', name: 'Deux', coordinates: { lat: 0, lng: 1.5 }, kind: 'PEAGE', tollCostXaf: 8000, direction: 'BOTH' },
    ]);
    prisma.waypoint.findMany.mockResolvedValue([]); // route vide initialement
    const svc = makeSvc(prisma);

    const out = await svc.attachDetected(TENANT, ROUTE, ['tp1', 'tp2']);
    expect(out.attached).toBe(2);
    expect(out.skipped).toBe(0);
    expect(prisma.waypoint.create).toHaveBeenCalledTimes(2);
  });

  it('skip les TollPoints non détectés (hors radius)', async () => {
    const prisma = makePrisma();
    prisma.route.findFirst.mockResolvedValue({
      id: ROUTE, tenantId: TENANT, distanceKm: 200,
      origin:      { coordinates: { lat: 0, lng: 0 } },
      destination: { coordinates: { lat: 0, lng: 2 } },
      waypoints: [],
    });
    // tp-far est à 5 km de la polyline → non détecté → non attaché
    prisma.tollPoint.findMany.mockResolvedValue([
      { id: 'tp-far', name: 'Loin', coordinates: { lat: 0.05, lng: 1 }, kind: 'PEAGE', tollCostXaf: 1000, direction: 'BOTH' },
    ]);
    prisma.waypoint.findMany.mockResolvedValue([]);
    const svc = makeSvc(prisma);

    const out = await svc.attachDetected(TENANT, ROUTE, ['tp-far']);
    expect(out.attached).toBe(0);
    expect(out.skipped).toBe(1);
    expect(prisma.waypoint.create).not.toHaveBeenCalled();
  });
});
