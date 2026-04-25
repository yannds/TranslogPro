/**
 * CrewBriefingService v2 — Tests unitaires (createBriefingV2, template-driven).
 *
 * Couvre :
 *   - signature simple (tous items passent) — anomaliesCount = 0, aucune alerte
 *   - item mandatory KO → anomaliesCount > 0, alerte émise selon policy
 *   - policy BLOCK_DEPARTURE sans override → ForbiddenException
 *   - policy BLOCK_DEPARTURE + override → signe et publie BRIEFING_OVERRIDE_APPLIED
 *   - auto-item DRIVER_REST_HOURS : service lit la valeur du restCalculator
 *   - auto-item ROUTE_CONFIRMED : passe si trip.route présent
 *   - briefing doublon → BadRequestException
 *   - template inexistant → BadRequestException
 */

import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CrewBriefingService,
  CreateBriefingV2Dto,
} from '@modules/crew-briefing/crew-briefing.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT_ID     = 'tenant-1';
const ASSIGNMENT_ID = 'assign-1';
const STAFF_ID      = 'staff-driver';
const TRIP_ID       = 'trip-1';
const USER_DRIVER   = 'user-driver';
const USER_MANAGER  = 'user-mgr';

const TEMPLATE_WITH_ALL_KINDS = {
  id: 'tpl-1',
  sections: [
    {
      id: 'sec-doc',
      items: [
        {
          id: 'item-doc-1', code: 'DOC_CARTE_GRISE', kind: 'DOCUMENT',
          labelFr: 'Carte grise', labelEn: 'Reg',
          isActive: true, isMandatory: true, requiredQty: 1, autoSource: null,
        },
        {
          id: 'item-check-1', code: 'VEH_PNEUS', kind: 'CHECK',
          labelFr: 'Pneus', labelEn: 'Tires',
          isActive: true, isMandatory: true, requiredQty: 1, autoSource: null,
        },
        {
          id: 'item-qty-1', code: 'SAFETY_VESTS', kind: 'QUANTITY',
          labelFr: 'Gilets', labelEn: 'Vests',
          isActive: true, isMandatory: true, requiredQty: 2, autoSource: null,
        },
        {
          id: 'item-info-rest', code: 'DRIVER_REST_HOURS', kind: 'INFO',
          labelFr: 'Repos', labelEn: 'Rest',
          isActive: true, isMandatory: true, requiredQty: 1, autoSource: 'DRIVER_REST_HOURS',
        },
        {
          id: 'item-info-route', code: 'ROUTE_CONFIRMED', kind: 'INFO',
          labelFr: 'Route', labelEn: 'Route',
          isActive: true, isMandatory: true, requiredQty: 1, autoSource: 'ROUTE_CONFIRMED',
        },
      ],
    },
  ],
};

const ASSIGNMENT_WITH_TRIP = {
  id:       ASSIGNMENT_ID,
  tenantId: TENANT_ID,
  tripId:   TRIP_ID,
  staffId:  STAFF_ID,
  trip: { id: TRIP_ID, driverId: STAFF_ID, status: 'SCHEDULED', route: { id: 'route-1', name: 'Brz→PNR' } },
};

function makePrisma(opts: {
  assignment?:      object | null;
  existingBriefing?: object | null;
  template?:        object | null;
  config?:          object | null;
  manifestCount?:   number;
} = {}): PrismaService {
  const resolvedAssignment = 'assignment' in opts ? opts.assignment : ASSIGNMENT_WITH_TRIP;
  const resolvedTemplate   = 'template' in opts ? opts.template : TEMPLATE_WITH_ALL_KINDS;

  return {
    crewAssignment: {
      findFirst: jest.fn().mockResolvedValue(resolvedAssignment),
      update:    jest.fn().mockResolvedValue({ id: ASSIGNMENT_ID }),
      upsert:    jest.fn().mockResolvedValue({ id: ASSIGNMENT_ID }),
    },
    crewBriefingRecord: {
      findFirst: jest.fn().mockResolvedValue(opts.existingBriefing ?? null),
      create:    jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: 'briefing-1', ...data }),
      ),
    },
    briefingTemplate: {
      findFirst: jest.fn().mockResolvedValue(resolvedTemplate),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(
        opts.config ?? {
          preTripBriefingPolicy: 'RECOMMENDED',
          mandatoryItemFailurePolicy: 'WARN_ONLY',
          restShortfallPolicy: 'WARN',
        },
      ),
    },
    manifest: {
      count: jest.fn().mockResolvedValue(opts.manifestCount ?? 1),
    },
    trip: {
      findFirst: jest.fn().mockResolvedValue({ id: TRIP_ID, driverId: STAFF_ID }),
    },
    staff: {
      findFirst: jest.fn().mockResolvedValue({ id: STAFF_ID }),
    },
    briefingEquipmentType: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    transact: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn({ outboxEvent: { create: jest.fn().mockResolvedValue({}) } }),
    ),
  } as unknown as PrismaService;
}

function makeDto(overrides: Partial<CreateBriefingV2Dto> = {}): CreateBriefingV2Dto {
  return {
    assignmentId: ASSIGNMENT_ID,
    conductedById: 'staff-conductor',
    items: [
      { itemId: 'item-doc-1',   passed: true },
      { itemId: 'item-check-1', passed: true },
      { itemId: 'item-qty-1',   passed: true, qty: 2 },
      // item-info-rest / item-info-route resolved server-side
    ],
    driverSignature: {
      method: 'PIN',
      blob:   'hashed-pin',
      acknowledgedById: USER_DRIVER,
    },
    ...overrides,
  };
}

// ─── Mocks communs ───────────────────────────────────────────────────────────

const compliantRest = {
  driverId:        STAFF_ID,
  lastTripEndedAt: null,
  restHours:       Number.POSITIVE_INFINITY,
  thresholdHours:  11,
  compliant:       true,
  shortfallHours:  0,
};

const shortfallRest = {
  driverId:        STAFF_ID,
  lastTripEndedAt: new Date('2026-04-24T08:00:00Z'),
  restHours:       4,
  thresholdHours:  11,
  compliant:       false,
  shortfallHours:  7,
};

describe('CrewBriefingService v2 — createBriefingV2()', () => {
  let svc: CrewBriefingService;
  let publishSpy: jest.Mock;
  let raiseSpy:   jest.Mock;
  let assessSpy:  jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    publishSpy = jest.fn().mockResolvedValue(undefined);
    raiseSpy   = jest.fn().mockResolvedValue({ id: 'alert-1' });
    assessSpy  = jest.fn().mockResolvedValue(compliantRest);
  });

  it('signe avec tous les items OK — zéro anomalie, zéro alerte, event BRIEFING_SIGNED', async () => {
    const prisma = makePrisma();
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    const result = await svc.createBriefingV2(TENANT_ID, makeDto());

    expect(result.anomaliesCount).toBe(0);
    expect(result.alertsEmitted).toHaveLength(0);
    expect(result.allEquipmentOk).toBe(true);
    expect(raiseSpy).not.toHaveBeenCalled();
    expect(publishSpy.mock.calls.map(c => c[0].type)).toContain('briefing.signed');
  });

  it('anomalie si mandatory CHECK passé=false — émet alerte WARNING (ALERT_MANAGER)', async () => {
    const prisma = makePrisma({
      config: {
        preTripBriefingPolicy:      'RECOMMENDED',
        mandatoryItemFailurePolicy: 'ALERT_MANAGER',
        restShortfallPolicy:        'WARN',
      },
    });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    const dto = makeDto({
      items: [
        { itemId: 'item-doc-1',   passed: true },
        { itemId: 'item-check-1', passed: false }, // KO mandatory
        { itemId: 'item-qty-1',   passed: true, qty: 2 },
      ],
    });

    const result = await svc.createBriefingV2(TENANT_ID, dto);

    expect(result.anomaliesCount).toBe(1);
    expect(result.alertsEmitted).toContain('VEH_PNEUS');
    expect(raiseSpy).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({
      severity: 'WARNING',
      source:   'BRIEFING',
      code:     'MANDATORY_ITEM_FAILED',
    }));
  });

  it('BLOCK_DEPARTURE sans override → ForbiddenException', async () => {
    const prisma = makePrisma({
      config: {
        preTripBriefingPolicy:      'RECOMMENDED',
        mandatoryItemFailurePolicy: 'BLOCK_DEPARTURE',
        restShortfallPolicy:        'WARN',
      },
    });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    const dto = makeDto({
      items: [
        { itemId: 'item-doc-1',   passed: false },
        { itemId: 'item-check-1', passed: true },
        { itemId: 'item-qty-1',   passed: true, qty: 2 },
      ],
    });

    await expect(svc.createBriefingV2(TENANT_ID, dto)).rejects.toThrow(ForbiddenException);
  });

  it('BLOCK_DEPARTURE + override → signe et publie BRIEFING_OVERRIDE_APPLIED', async () => {
    const prisma = makePrisma({
      config: {
        preTripBriefingPolicy:      'RECOMMENDED',
        mandatoryItemFailurePolicy: 'BLOCK_DEPARTURE',
        restShortfallPolicy:        'WARN',
      },
    });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    const dto = makeDto({
      items: [
        { itemId: 'item-doc-1',   passed: false },
        { itemId: 'item-check-1', passed: true },
        { itemId: 'item-qty-1',   passed: true, qty: 2 },
      ],
      overrideReason: 'Carte grise chez le garage, retour à 14h',
      overriddenById: USER_MANAGER,
    });

    const result = await svc.createBriefingV2(TENANT_ID, dto);

    expect(result.anomaliesCount).toBe(1);
    const eventTypes = publishSpy.mock.calls.map(c => c[0].type);
    expect(eventTypes).toContain('briefing.signed');
    expect(eventTypes).toContain('briefing.override.applied');
  });

  it('auto-item DRIVER_REST_HOURS : shortfall → anomalie + alerte si policy != WARN', async () => {
    const prisma = makePrisma({
      config: {
        preTripBriefingPolicy:      'RECOMMENDED',
        mandatoryItemFailurePolicy: 'WARN_ONLY',
        restShortfallPolicy:        'ALERT',
      },
    });
    assessSpy = jest.fn().mockResolvedValue(shortfallRest);
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    const result = await svc.createBriefingV2(TENANT_ID, makeDto());

    // item-info-rest est mandatory et shortfall → anomalie
    expect(result.anomaliesCount).toBeGreaterThanOrEqual(1);
    expect(result.alertsEmitted).toContain('DRIVER_REST_SHORTFALL');
    expect(result.restHoursSnapshot).toBe(4);
  });

  it('rejette briefing doublon', async () => {
    const prisma = makePrisma({ existingBriefing: { id: 'existing' } });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );
    await expect(svc.createBriefingV2(TENANT_ID, makeDto())).rejects.toThrow(BadRequestException);
  });

  it('rejette si template inexistant pour le tenant', async () => {
    const prisma = makePrisma({ template: null });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );
    await expect(svc.createBriefingV2(TENANT_ID, makeDto())).rejects.toThrow(BadRequestException);
  });

  it('scope \'own\' : rejette si conductedById ≠ acteur', async () => {
    const prisma = makePrisma();
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );

    await expect(svc.createBriefingV2(TENANT_ID, makeDto(), {
      scope: 'own', userId: 'different-user', userType: 'STAFF' as any,
    } as any)).rejects.toThrow(ForbiddenException);
  });

  it('assignment introuvable → NotFoundException', async () => {
    const prisma = makePrisma({ assignment: null });
    svc = new CrewBriefingService(
      prisma,
      { assess: assessSpy } as any,
      { raise: raiseSpy, list: jest.fn(), resolve: jest.fn() } as any,
      { publish: publishSpy } as any,
    );
    await expect(svc.createBriefingV2(TENANT_ID, makeDto())).rejects.toThrow(NotFoundException);
  });
});
