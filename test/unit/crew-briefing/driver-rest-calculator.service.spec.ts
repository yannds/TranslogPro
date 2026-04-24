/**
 * DriverRestCalculatorService — Tests unitaires.
 * Couvre : compliant, shortfall, absence de dernier trajet, seuil custom tenant.
 */

import { DriverRestCalculatorService } from '@modules/crew-briefing/driver-rest-calculator.service';
import { PrismaService }                from '@infra/database/prisma.service';

const TENANT_ID = 'tenant-1';
const DRIVER_ID = 'driver-staff-1';

function makePrisma(opts: {
  minHours?:     number;
  lastTrip?:     { arrivalActual: Date | null; arrivalScheduled: Date | null; status?: string } | null;
} = {}): PrismaService {
  return {
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(
        opts.minHours !== undefined ? { minDriverRestHours: opts.minHours } : null,
      ),
    },
    trip: {
      findFirst: jest.fn().mockResolvedValue(opts.lastTrip ?? null),
    },
  } as unknown as PrismaService;
}

describe('DriverRestCalculatorService', () => {
  let svc: DriverRestCalculatorService;

  it('repos infini si aucun trajet précédent (cas nouveau chauffeur)', async () => {
    const prisma = makePrisma({ lastTrip: null });
    svc = new DriverRestCalculatorService(prisma);

    const result = await svc.assess(TENANT_ID, DRIVER_ID, new Date('2026-04-24T10:00:00Z'));

    expect(result.lastTripEndedAt).toBeNull();
    expect(result.compliant).toBe(true);
    expect(result.shortfallHours).toBe(0);
    expect(result.restHours).toBe(Number.POSITIVE_INFINITY);
  });

  it('compliant si le dernier trajet terminé est à plus du seuil tenant', async () => {
    const now      = new Date('2026-04-24T18:00:00Z');
    const lastTrip = { arrivalActual: new Date('2026-04-24T02:00:00Z'), arrivalScheduled: null }; // -16h
    const prisma   = makePrisma({ lastTrip, minHours: 11 });
    svc = new DriverRestCalculatorService(prisma);

    const result = await svc.assess(TENANT_ID, DRIVER_ID, now);

    expect(result.compliant).toBe(true);
    expect(result.restHours).toBeCloseTo(16, 1);
    expect(result.thresholdHours).toBe(11);
  });

  it('shortfall si le dernier trajet est à moins du seuil tenant', async () => {
    const now      = new Date('2026-04-24T10:00:00Z');
    const lastTrip = { arrivalActual: new Date('2026-04-24T05:00:00Z'), arrivalScheduled: null }; // -5h
    const prisma   = makePrisma({ lastTrip, minHours: 11 });
    svc = new DriverRestCalculatorService(prisma);

    const result = await svc.assess(TENANT_ID, DRIVER_ID, now);

    expect(result.compliant).toBe(false);
    expect(result.restHours).toBeCloseTo(5, 1);
    expect(result.shortfallHours).toBeCloseTo(6, 1);
  });

  it('utilise le défaut 11h si aucun config tenant', async () => {
    const now      = new Date('2026-04-24T12:00:00Z');
    const lastTrip = { arrivalActual: new Date('2026-04-24T02:00:00Z'), arrivalScheduled: null }; // -10h
    const prisma   = makePrisma({ lastTrip }); // pas de minHours
    svc = new DriverRestCalculatorService(prisma);

    const result = await svc.assess(TENANT_ID, DRIVER_ID, now);

    expect(result.thresholdHours).toBe(11);
    expect(result.compliant).toBe(false); // 10h < 11h
  });

  it('utilise arrivalScheduled si arrivalActual absent', async () => {
    const now      = new Date('2026-04-24T20:00:00Z');
    const lastTrip = { arrivalActual: null, arrivalScheduled: new Date('2026-04-24T05:00:00Z'), status: 'COMPLETED' }; // -15h
    const prisma   = makePrisma({ lastTrip, minHours: 11 });
    svc = new DriverRestCalculatorService(prisma);

    const result = await svc.assess(TENANT_ID, DRIVER_ID, now);

    expect(result.compliant).toBe(true);
    expect(result.restHours).toBeCloseTo(15, 1);
  });
});
