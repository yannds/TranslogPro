/**
 * DriverProfileService — Tests unitaires
 *
 * Stratégie : PrismaService mocké, EventBus mocké, StorageService mocké.
 * Tests focalisés sur :
 *   - _computeLicenseStatus() (helper privé — testé via createLicense)
 *   - checkRestCompliance() : cas open rest, rest terminé récent, premier trajet
 *   - evaluateRemediationForDriver() : seuil non atteint, règle déclenchée, doublon ignoré
 */

import { DriverProfileService } from '../driver-profile.service';
import { PrismaService }         from '../../../infrastructure/database/prisma.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type PrivateDriver = {
  _computeLicenseStatus(expiresAt: Date, alertDays: number): string;
};

function asPrivate(svc: DriverProfileService): PrivateDriver {
  return svc as unknown as PrivateDriver;
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

// ─── Mock factory ─────────────────────────────────────────────────────────────

const REST_CONFIG_DEFAULT = {
  tenantId:              'tenant-1',
  minRestMinutes:        480,   // 8h
  maxDrivingMinutesPerDay: 600, // 10h
  alertBeforeMinutes:    60,
};

function makePrisma(opts: {
  restConfig?:          object | null;
  openRestPeriod?:      object | null;
  lastRestPeriod?:      object | null;
  remediationRules?:    object[];
  activeRemediations?:  object[];
  createRemediation?:   object;
} = {}): PrismaService {
  return {
    driverRestConfig: {
      findUnique: jest.fn().mockResolvedValue(opts.restConfig ?? REST_CONFIG_DEFAULT),
      upsert:     jest.fn().mockResolvedValue(opts.restConfig ?? REST_CONFIG_DEFAULT),
    },
    driverRestPeriod: {
      findFirst: jest.fn()
        .mockResolvedValueOnce(opts.openRestPeriod ?? null)   // open period
        .mockResolvedValueOnce(opts.lastRestPeriod ?? null),  // last closed period
    },
    driverRemediationRule: {
      findMany: jest.fn().mockResolvedValue(opts.remediationRules ?? []),
    },
    driverRemediationAction: {
      // findFirst used inside evaluateRemediationForDriver loop for per-rule duplicate check
      findFirst: jest.fn().mockResolvedValue(
        opts.activeRemediations && opts.activeRemediations.length > 0
          ? opts.activeRemediations[0]
          : null,
      ),
      findMany: jest.fn().mockResolvedValue(opts.activeRemediations ?? []),
      create:   jest.fn().mockResolvedValue(opts.createRemediation ?? { id: 'action-1' }),
    },
    driverTraining: {
      create: jest.fn().mockResolvedValue({ id: 'training-1' }),
    },
  } as unknown as PrismaService;
}

const mockStorage  = {} as any;
const mockEventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;

const TENANT_ID = 'tenant-1';
const STAFF_ID  = 'staff-1';

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DriverProfileService', () => {
  let svc: DriverProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new DriverProfileService(makePrisma(), mockStorage, mockEventBus);
  });

  // ── _computeLicenseStatus ──────────────────────────────────────────────────

  describe('_computeLicenseStatus()', () => {
    const p = () => asPrivate(svc);

    it('retourne EXPIRED si date dans le passé', () => {
      expect(p()._computeLicenseStatus(daysFromNow(-1), 30)).toBe('EXPIRED');
    });

    it('retourne EXPIRING si dans la fenêtre d\'alerte', () => {
      expect(p()._computeLicenseStatus(daysFromNow(15), 30)).toBe('EXPIRING');
    });

    it('retourne VALID si hors fenêtre d\'alerte', () => {
      expect(p()._computeLicenseStatus(daysFromNow(60), 30)).toBe('VALID');
    });
  });

  // ── checkRestCompliance ────────────────────────────────────────────────────

  describe('checkRestCompliance()', () => {
    it('canDrive=false et restRemainingMinutes > 0 si période ouverte récente', async () => {
      const startedAt = new Date(Date.now() - 60 * 60_000); // 60 min ago
      const prisma = makePrisma({ openRestPeriod: { id: 'rp-1', startedAt, endedAt: null } });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const result = await svc.checkRestCompliance(TENANT_ID, STAFF_ID);
      expect(result.canDrive).toBe(false);
      expect(result.restRemainingMinutes).toBeGreaterThan(0);
      expect(result.activeRestPeriod).not.toBeNull();
    });

    it('canDrive=true si période ouverte mais temps déjà dépassé', async () => {
      const startedAt = new Date(Date.now() - 600 * 60_000); // 10h ago
      const prisma = makePrisma({
        openRestPeriod: { id: 'rp-1', startedAt, endedAt: null },
        // minRest=480 → 600 > 480 → canDrive=true
      });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const result = await svc.checkRestCompliance(TENANT_ID, STAFF_ID);
      expect(result.canDrive).toBe(true);
      expect(result.restRemainingMinutes).toBe(0);
    });

    it('canDrive=true si aucun historique de repos (premier trajet)', async () => {
      const prisma = makePrisma({ openRestPeriod: null, lastRestPeriod: null });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const result = await svc.checkRestCompliance(TENANT_ID, STAFF_ID);
      expect(result.canDrive).toBe(true);
      expect(result.activeRestPeriod).toBeNull();
    });

    it('canDrive=false si dernier repos terminé depuis trop longtemps (> maxDrivingMinutes)', async () => {
      const endedAt = new Date(Date.now() - 700 * 60_000); // 700 min ago > maxDriving=600
      const prisma = makePrisma({
        openRestPeriod: null,
        lastRestPeriod: { id: 'rp-0', startedAt: new Date(), endedAt },
      });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const result = await svc.checkRestCompliance(TENANT_ID, STAFF_ID);
      expect(result.canDrive).toBe(false);
    });
  });

  // ── evaluateRemediationForDriver ───────────────────────────────────────────

  describe('evaluateRemediationForDriver()', () => {
    it('retourne tableau vide si aucune règle définie pour le tenant', async () => {
      const prisma = makePrisma({ remediationRules: [] });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const triggered = await svc.evaluateRemediationForDriver(TENANT_ID, STAFF_ID, 85);
      expect(triggered).toHaveLength(0);
    });

    it('retourne tableau vide si la requête DB ne retourne aucune règle (seuil non atteint)', async () => {
      // DB filter scoreBelowThreshold >= currentScore is done by Prisma.
      // When mock returns [] it means no matching rules (score above threshold).
      const prisma = makePrisma({ remediationRules: [] });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const triggered = await svc.evaluateRemediationForDriver(TENANT_ID, STAFF_ID, 85);
      expect(triggered).toHaveLength(0);
    });

    it('déclenche la règle si score en dessous du seuil', async () => {
      const rule = {
        id: 'rule-1', scoreBelowThreshold: 80, tenantId: TENANT_ID, isActive: true,
        priority: 1, name: 'Avertissement', actionType: 'WARNING', description: '',
        trainingTypeId: null, suspensionDays: null,
      };
      const prisma = makePrisma({
        remediationRules: [rule],
        activeRemediations: [], // aucun doublon
      });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const triggered = await svc.evaluateRemediationForDriver(TENANT_ID, STAFF_ID, 65);
      expect(triggered).toHaveLength(1);
      expect(triggered[0]).toBe('action-1'); // retourne les actionIds créés
    });

    it('ignore le doublon si une action PENDING existe déjà pour cette règle', async () => {
      const rule = {
        id: 'rule-1', scoreBelowThreshold: 80, tenantId: TENANT_ID, isActive: true,
        priority: 1, name: 'Formation', actionType: 'TRAINING', description: '',
      };
      const prisma = makePrisma({
        remediationRules: [rule],
        activeRemediations: [
          { id: 'action-existing', ruleId: 'rule-1', staffId: STAFF_ID, status: 'PENDING' },
        ],
      });
      svc = new DriverProfileService(prisma, mockStorage, mockEventBus);

      const triggered = await svc.evaluateRemediationForDriver(TENANT_ID, STAFF_ID, 65);
      // Doublon ignoré → aucune nouvelle action créée
      expect(triggered).toHaveLength(0);
    });
  });
});
