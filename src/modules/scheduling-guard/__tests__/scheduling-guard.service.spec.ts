/**
 * SchedulingGuardService — Tests unitaires
 *
 * Stratégie : PrismaService entièrement mocké.
 * Tests pour checkAssignability() : bus maintenance, bus out-of-service,
 * expired mandatory docs, driver rest, driver suspension, expired license,
 * et cas nominal (aucun blocage).
 */

import { SchedulingGuardService } from '../scheduling-guard.service';
import { PrismaService }           from '../../../infrastructure/database/prisma.service';

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrisma(overrides: Partial<Record<string, jest.Mock>> = {}): PrismaService {
  return {
    bus: {
      findFirst: overrides.busFindFirst ?? jest.fn().mockResolvedValue(null),
    },
    vehicleDocument: {
      findMany: overrides.vehicleDocumentFindMany ?? jest.fn().mockResolvedValue([]),
    },
    driverRestConfig: {
      findUnique: overrides.driverRestConfigFindUnique ?? jest.fn().mockResolvedValue(null),
    },
    driverRestPeriod: {
      findFirst: overrides.driverRestPeriodFindFirst ?? jest.fn().mockResolvedValue(null),
    },
    driverRemediationAction: {
      findFirst: overrides.driverRemediationActionFindFirst ?? jest.fn().mockResolvedValue(null),
    },
    driverLicense: {
      findFirst: overrides.driverLicenseFindFirst ?? jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;
}

const TENANT_ID = 'tenant-1';
const BUS_ID    = 'bus-1';
const STAFF_ID  = 'staff-1';

const BUS_OK = {
  id:          BUS_ID,
  tenantId:    TENANT_ID,
  status:      'ACTIVE',
  plateNumber: 'AB-1234-CD',
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('SchedulingGuardService', () => {

  // ── Bus checks ──────────────────────────────────────────────────────────────

  describe('Bus checks', () => {
    it('bloque BUS_MAINTENANCE si status = MAINTENANCE_REQUIRED', async () => {
      const prisma = makePrisma({
        busFindFirst: jest.fn().mockResolvedValue({ ...BUS_OK, status: 'MAINTENANCE_REQUIRED' }),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'BUS_MAINTENANCE' }));
    });

    it('bloque BUS_OUT_OF_SERVICE si status = OUT_OF_SERVICE', async () => {
      const prisma = makePrisma({
        busFindFirst: jest.fn().mockResolvedValue({ ...BUS_OK, status: 'OUT_OF_SERVICE' }),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'BUS_OUT_OF_SERVICE' }));
    });

    it('bloque BUS_OUT_OF_SERVICE si status = RETIRED', async () => {
      const prisma = makePrisma({
        busFindFirst: jest.fn().mockResolvedValue({ ...BUS_OK, status: 'RETIRED' }),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'BUS_OUT_OF_SERVICE' }));
    });

    it('bloque BUS_OUT_OF_SERVICE si bus introuvable', async () => {
      const prisma = makePrisma({ busFindFirst: jest.fn().mockResolvedValue(null) });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons[0].code).toBe('BUS_OUT_OF_SERVICE');
    });

    it('bloque BUS_DOCUMENT_EXPIRED si un doc obligatoire est expiré', async () => {
      const prisma = makePrisma({
        busFindFirst: jest.fn().mockResolvedValue(BUS_OK),
        vehicleDocumentFindMany: jest.fn().mockResolvedValue([
          { type: { code: 'CT', name: 'Contrôle technique' }, expiresAt: new Date('2020-01-01') },
        ]),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'BUS_DOCUMENT_EXPIRED' }));
    });

    it('ne bloque pas si bus ACTIVE et aucun doc expiré', async () => {
      const prisma = makePrisma({
        busFindFirst:            jest.fn().mockResolvedValue(BUS_OK),
        vehicleDocumentFindMany: jest.fn().mockResolvedValue([]),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID);
      expect(result.canAssign).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });
  });

  // ── Driver checks ────────────────────────────────────────────────────────────

  describe('Driver checks', () => {
    it('bloque DRIVER_REST_REQUIRED si période de repos ouverte avec temps restant', async () => {
      const startedAt = new Date(Date.now() - 30 * 60_000); // démarré il y a 30 min
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue({ minRestMinutes: 120 }),
        driverRestPeriodFindFirst:  jest.fn().mockResolvedValue({ startedAt, endedAt: null }),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'DRIVER_REST_REQUIRED' }));
      // 90 minutes restantes environ
      expect(result.reasons[0].data?.restRemainingMinutes).toBeGreaterThan(0);
    });

    it('ne bloque pas si la période de repos est terminée (temps écoulé >= minRest)', async () => {
      const startedAt = new Date(Date.now() - 180 * 60_000); // démarré il y a 3h
      const validLicense = { id: 'lic-1', category: 'D', status: 'VALID' };
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue({ minRestMinutes: 120 }),
        driverRestPeriodFindFirst:  jest.fn().mockResolvedValue({ startedAt, endedAt: null }),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue(null),
        // First call: valid license found → no block
        driverLicenseFindFirst: jest.fn().mockResolvedValue(validLicense),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(true);
    });

    it('ne bloque pas le repos si aucune config tenant', async () => {
      const validLicense = { id: 'lic-1', category: 'D', status: 'VALID' };
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue(null),
        driverLicenseFindFirst: jest.fn().mockResolvedValue(validLicense),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(true);
    });

    it('bloque DRIVER_SUSPENDED si action de suspension PENDING', async () => {
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue({
          id: 'action-1',
          rule: { name: 'Infractions multiples' },
        }),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'DRIVER_SUSPENDED' }));
    });

    it('bloque DRIVER_LICENSE_EXPIRED si aucun permis D/EC/D+E trouvé', async () => {
      // findFirst x2 : premier (VALID/EXPIRING) → null, second (any) → null
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue(null),
        driverLicenseFindFirst: jest.fn().mockResolvedValue(null), // aucun permis
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'DRIVER_LICENSE_EXPIRED' }));
    });

    it('bloque DRIVER_LICENSE_EXPIRED si permis D expiré (pas dans VALID/EXPIRING)', async () => {
      // Premier findFirst (VALID/EXPIRING) → null (aucun valide)
      // Second findFirst (any D/EC) → expired license
      const expiredLicense = { id: 'lic-1', category: 'D', status: 'EXPIRED' };
      const findFirstMock = jest.fn()
        .mockResolvedValueOnce(null)           // pas de valide
        .mockResolvedValueOnce(expiredLicense); // mais en a un expiré
      const prisma = makePrisma({
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue(null),
        driverLicenseFindFirst: findFirstMock,
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, undefined, STAFF_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'DRIVER_LICENSE_EXPIRED' }));
    });
  });

  // ── Combiné bus + driver ──────────────────────────────────────────────────────

  describe('Combined bus + driver checks', () => {
    it('cumule plusieurs raisons de blocage (bus + driver)', async () => {
      const prisma = makePrisma({
        busFindFirst: jest.fn().mockResolvedValue({ ...BUS_OK, status: 'MAINTENANCE_REQUIRED' }),
        vehicleDocumentFindMany: jest.fn().mockResolvedValue([]),
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue({
          id: 'a-1', rule: { name: 'Suspension test' },
        }),
        driverLicenseFindMany: jest.fn().mockResolvedValue([
          { categories: ['D'], expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), status: 'VALID' },
        ]),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID, STAFF_ID);
      expect(result.canAssign).toBe(false);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
      const codes = result.reasons.map(r => r.code);
      expect(codes).toContain('BUS_MAINTENANCE');
      expect(codes).toContain('DRIVER_SUSPENDED');
    });

    it('ne bloque pas si bus OK et driver OK', async () => {
      const validLicense = { id: 'lic-1', category: 'D', status: 'VALID' };
      const prisma = makePrisma({
        busFindFirst:            jest.fn().mockResolvedValue(BUS_OK),
        vehicleDocumentFindMany: jest.fn().mockResolvedValue([]),
        driverRestConfigFindUnique: jest.fn().mockResolvedValue(null),
        driverRemediationActionFindFirst: jest.fn().mockResolvedValue(null),
        driverLicenseFindFirst: jest.fn().mockResolvedValue(validLicense),
      });
      const svc = new SchedulingGuardService(prisma);
      const result = await svc.checkAssignability(TENANT_ID, BUS_ID, STAFF_ID);
      expect(result.canAssign).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });
  });

  // ── Vérification sans busId ni staffId ────────────────────────────────────────

  it('retourne canAssign=true si ni busId ni staffId fournis', async () => {
    const svc = new SchedulingGuardService(makePrisma());
    const result = await svc.checkAssignability(TENANT_ID);
    expect(result.canAssign).toBe(true);
  });
});
