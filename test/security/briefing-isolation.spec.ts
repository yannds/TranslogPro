/**
 * Security — Briefing pré-voyage QHSE (refonte 2026-04-24).
 *
 * Couvre :
 *   1. Cross-tenant isolation — un service tenant-scopé rejette toute ressource
 *      hors tenant (template, alerte, briefing) par le filtre racine tenantId.
 *   2. Scope 'own' — un chauffeur ne peut signer un briefing que pour lui-même
 *      (conductedById doit correspondre à scope.userId).
 *   3. Enforcement politique BLOCK_DEPARTURE — impossible de signer avec item
 *      mandatory KO sans override justifié (reason + manager id).
 *   4. Alerte immuable — impossible de re-résoudre une alerte déjà close.
 *
 * Tous les services sont injectés avec Prisma mocké. Tests service-level
 * (on vérifie le contrat de sécurité, pas l'HTTP stack).
 */

import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { CrewBriefingService } from '@modules/crew-briefing/crew-briefing.service';
import { BriefingTemplateService } from '@modules/crew-briefing/briefing-template.service';
import { TripSafetyAlertService } from '@modules/crew-briefing/trip-safety-alert.service';

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

// ─── Helper builders ────────────────────────────────────────────────────────

const COMPLIANT_REST = {
  driverId:        'd1', lastTripEndedAt: null,
  restHours:       Number.POSITIVE_INFINITY,
  thresholdHours:  11, compliant: true, shortfallHours: 0,
};

const TEMPLATE_WITH_ONE_MANDATORY = {
  id: 'tpl-1',
  sections: [{
    id: 'sec-1',
    items: [{
      id: 'item-1', code: 'DOC', kind: 'DOCUMENT',
      labelFr: 'Doc', labelEn: 'Doc', isActive: true, isMandatory: true,
      requiredQty: 1, autoSource: null,
    }],
  }],
};

function makeBriefingPrisma(opts: {
  assignment?: any;
  config?: any;
  template?: any;
  existingBriefing?: any;
} = {}): any {
  return {
    crewAssignment: {
      findFirst: jest.fn().mockResolvedValue(opts.assignment ?? {
        id: 'a1', tenantId: TENANT_A, tripId: 'trip-a', staffId: 'staff-a',
        trip: { id: 'trip-a', driverId: 'staff-a', status: 'SCHEDULED', route: { id: 'route-1', name: 'A→B' } },
      }),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    },
    crewBriefingRecord: {
      findFirst: jest.fn().mockResolvedValue(opts.existingBriefing ?? null),
      create:    jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'br-1', ...data })),
    },
    briefingTemplate:     { findFirst: jest.fn().mockResolvedValue(opts.template ?? TEMPLATE_WITH_ONE_MANDATORY) },
    tenantBusinessConfig: { findUnique: jest.fn().mockResolvedValue(opts.config ?? {
      preTripBriefingPolicy: 'RECOMMENDED',
      mandatoryItemFailurePolicy: 'BLOCK_DEPARTURE',
      restShortfallPolicy: 'WARN',
    }) },
    manifest: { count: jest.fn().mockResolvedValue(1) },
    trip:     { findFirst: jest.fn().mockResolvedValue({ id: 'trip-a', driverId: 'staff-a' }) },
    staff:    { findFirst: jest.fn().mockResolvedValue({ id: 'staff-a' }) },
    briefingEquipmentType: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

const mockRestCalc = { assess: jest.fn().mockResolvedValue(COMPLIANT_REST) } as any;
const mockAlertSvc = { raise: jest.fn().mockResolvedValue({ id: 'alert-1' }), list: jest.fn(), resolve: jest.fn() } as any;
const mockEventBus = { publish: jest.fn().mockResolvedValue(undefined) };

// ─── 1. Cross-tenant isolation ──────────────────────────────────────────────

describe('Security — Cross-tenant isolation', () => {

  it('BriefingTemplateService.getById() refuse un template d\'un autre tenant', async () => {
    const prisma = {
      briefingTemplate: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          // Template appartient à TENANT_B, service appelé avec TENANT_A → null
          if (where.tenantId === TENANT_A) return null;
          return { id: where.id, tenantId: where.tenantId, sections: [] };
        }),
      },
    } as any;
    const svc = new BriefingTemplateService(prisma);

    await expect(svc.getById(TENANT_A, 'tpl-of-B')).rejects.toThrow(NotFoundException);
    expect(prisma.briefingTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tpl-of-B', tenantId: TENANT_A } }),
    );
  });

  it('TripSafetyAlertService.raise() refuse un trip d\'un autre tenant', async () => {
    const prisma = {
      trip: { findFirst: jest.fn().mockImplementation(({ where }: any) =>
        where.tenantId === TENANT_A ? null : { id: where.id }) },
      tripSafetyAlert: { create: jest.fn() },
    } as any;
    const svc = new TripSafetyAlertService(prisma, { publish: jest.fn() } as any);

    await expect(svc.raise(TENANT_A, {
      tripId: 'trip-of-B', severity: 'WARNING', source: 'BRIEFING', code: 'X',
    })).rejects.toThrow(NotFoundException);
    expect(prisma.tripSafetyAlert.create).not.toHaveBeenCalled();
  });

  it('TripSafetyAlertService.resolve() refuse une alerte d\'un autre tenant', async () => {
    const prisma = {
      tripSafetyAlert: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          where.tenantId === TENANT_A ? null : { id: where.id, tripId: 't', resolvedAt: null }),
        update: jest.fn(),
      },
    } as any;
    const svc = new TripSafetyAlertService(prisma, { publish: jest.fn() } as any);

    await expect(svc.resolve(TENANT_A, 'alert-of-B', { resolvedById: 'u1' }))
      .rejects.toThrow(NotFoundException);
    expect(prisma.tripSafetyAlert.update).not.toHaveBeenCalled();
  });

  it('TripSafetyAlertService.list() filtre strictement par tenantId racine', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { tripSafetyAlert: { findMany } } as any;
    const svc = new TripSafetyAlertService(prisma, { publish: jest.fn() } as any);

    await svc.list(TENANT_A, { resolved: false });

    expect(findMany.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT_A, resolvedAt: null });
  });

  it('CrewBriefingService.getBriefingForAssignment() filtre par tenantId racine', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { crewBriefingRecord: { findFirst } } as any;
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    await expect(svc.getBriefingForAssignment(TENANT_A, 'assign-of-B'))
      .rejects.toThrow(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT_A });
  });
});

// ─── 2. Scope 'own' enforcement ─────────────────────────────────────────────

describe('Security — Scope \'own\' enforcement', () => {

  it('createBriefingV2() refuse si scope=own et conductedById ≠ acteur', async () => {
    const prisma = makeBriefingPrisma();
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    await expect(svc.createBriefingV2(TENANT_A, {
      assignmentId:  'a1',
      conductedById: 'staff-X',
      items: [],
      driverSignature: { method: 'PIN', blob: 'h', acknowledgedById: 'user-d' },
    } as any, {
      scope: 'own', userId: 'user-intruder', userType: 'DRIVER' as any,
    } as any)).rejects.toThrow(ForbiddenException);
  });

  it('createBriefing v1 refuse également un conductedById ≠ acteur en scope own', async () => {
    const prisma = makeBriefingPrisma();
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    await expect(svc.createBriefing(TENANT_A, {
      assignmentId:  'a1',
      conductedById: 'staff-X',
      checkedItems:  [],
    } as any, {
      scope: 'own', userId: 'user-intruder',
    } as any)).rejects.toThrow(ForbiddenException);
  });
});

// ─── 3. BLOCK_DEPARTURE enforcement ─────────────────────────────────────────

describe('Security — Politique BLOCK_DEPARTURE ne peut être contournée sans override', () => {

  beforeEach(() => jest.clearAllMocks());

  it('Refuse signature si item mandatory KO sans override (policy=BLOCK_DEPARTURE)', async () => {
    const prisma = makeBriefingPrisma(); // policy par défaut du helper = BLOCK_DEPARTURE
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    await expect(svc.createBriefingV2(TENANT_A, {
      assignmentId:  'a1',
      conductedById: 'staff-cond',
      items: [{ itemId: 'item-1', passed: false }], // mandatory KO
      driverSignature: { method: 'PIN', blob: 'h', acknowledgedById: 'user-d' },
    } as any)).rejects.toThrow(ForbiddenException);
    expect(prisma.crewBriefingRecord.create).not.toHaveBeenCalled();
  });

  it('Accepte signature avec override COMPLET (reason + managerId)', async () => {
    const prisma = makeBriefingPrisma();
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    const result = await svc.createBriefingV2(TENANT_A, {
      assignmentId:  'a1',
      conductedById: 'staff-cond',
      items: [{ itemId: 'item-1', passed: false }],
      driverSignature: { method: 'PIN', blob: 'h', acknowledgedById: 'user-d' },
      overrideReason: 'Doc faxé, original à 14h',
      overriddenById: 'user-mgr',
    } as any);

    expect(result.anomaliesCount).toBe(1);
    expect(prisma.crewBriefingRecord.create).toHaveBeenCalledTimes(1);
    const created = (prisma.crewBriefingRecord.create as jest.Mock).mock.calls[0][0].data;
    expect(created.overrideReason).toBe('Doc faxé, original à 14h');
    expect(created.overriddenById).toBe('user-mgr');
    expect(created.overriddenAt).toBeInstanceOf(Date);
  });

  it('Refuse override INCOMPLET (reason sans managerId → pas de contournement)', async () => {
    const prisma = makeBriefingPrisma();
    const svc = new CrewBriefingService(prisma, mockRestCalc, mockAlertSvc, mockEventBus as any);

    await expect(svc.createBriefingV2(TENANT_A, {
      assignmentId:  'a1',
      conductedById: 'staff-cond',
      items: [{ itemId: 'item-1', passed: false }],
      driverSignature: { method: 'PIN', blob: 'h', acknowledgedById: 'user-d' },
      overrideReason: 'Raison sans manager',
      // overriddenById: undefined — contrat : les deux sont requis ensemble
    } as any)).rejects.toThrow(ForbiddenException);
  });
});

// ─── 4. Alerte immuable (resolve one-shot) ──────────────────────────────────

describe('Security — Alerte sécurité immuable (clôture unique)', () => {

  it('Impossible de re-résoudre une alerte déjà close', async () => {
    const prisma = {
      tripSafetyAlert: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'alert-1',
          tripId: 'trip-a',
          resolvedAt: new Date('2026-04-20T10:00:00Z'),
        }),
        update: jest.fn(),
      },
    } as any;
    const svc = new TripSafetyAlertService(prisma, { publish: jest.fn() } as any);

    await expect(svc.resolve(TENANT_A, 'alert-1', { resolvedById: 'u-other' }))
      .rejects.toThrow(BadRequestException);
    expect(prisma.tripSafetyAlert.update).not.toHaveBeenCalled();
  });
});
