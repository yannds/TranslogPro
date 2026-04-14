/**
 * CrewBriefingService — Tests unitaires
 *
 * Stratégie : PrismaService mocké, EventBus mocké.
 * Tests centrés sur la logique allEquipmentOk / missingEquipmentCodes
 * de createBriefing() et sur les cas d'erreur (assignment introuvable,
 * doublon de briefing).
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CrewBriefingService }                    from '../crew-briefing.service';
import { PrismaService }                          from '../../../infrastructure/database/prisma.service';

// ─── Constantes ────────────────────────────────────────────────────────────────

const TENANT_ID     = 'tenant-1';
const ASSIGNMENT_ID = 'assign-1';
const CONDUCTED_BY  = 'staff-1';

// Equipment type IDs
const EQ_GILET     = 'eq-gilet';
const EQ_LAMPE     = 'eq-lampe';
const EQ_TROUSSE   = 'eq-trousse';

const MANDATORY_TYPES = [
  { id: EQ_GILET,   code: 'GILET',   isMandatory: true, isActive: true, requiredQty: 2 },
  { id: EQ_LAMPE,   code: 'LAMPE',   isMandatory: true, isActive: true, requiredQty: 1 },
  { id: EQ_TROUSSE, code: 'TROUSSE', isMandatory: true, isActive: true, requiredQty: 1 },
];

const ASSIGNMENT = { id: ASSIGNMENT_ID, tenantId: TENANT_ID };

const CREATED_RECORD = {
  id:            'briefing-1',
  tenantId:      TENANT_ID,
  assignmentId:  ASSIGNMENT_ID,
  conductedById: CONDUCTED_BY,
  allEquipmentOk: true,
  completedAt:   new Date(),
  briefingNotes: null,
  gpsLat:        null,
  gpsLng:        null,
  checkedItems:  [],
};

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makePrisma(opts: {
  assignment?:      object | null;
  existingBriefing?: object | null;
  mandatoryTypes?:  object[];
  createResult?:    object;
} = {}): PrismaService {
  // Use `'assignment' in opts` to distinguish null (passed) from undefined (not passed)
  const resolvedAssignment = 'assignment' in opts ? opts.assignment : ASSIGNMENT;
  return {
    crewAssignment: {
      findFirst: jest.fn().mockResolvedValue(resolvedAssignment),
    },
    crewBriefingRecord: {
      findFirst: jest.fn().mockResolvedValue(opts.existingBriefing ?? null),
      create:    jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...CREATED_RECORD, ...data, id: 'briefing-1' }),
      ),
      findMany:  jest.fn().mockResolvedValue([]),
    },
    briefingEquipmentType: {
      findMany: jest.fn().mockResolvedValue(opts.mandatoryTypes ?? MANDATORY_TYPES),
      create:   jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaService;
}

const mockEventBus = { publish: jest.fn() } as any;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('CrewBriefingService', () => {
  let svc: CrewBriefingService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createBriefing — allEquipmentOk ────────────────────────────────────────

  describe('createBriefing()', () => {

    it('allEquipmentOk=true si tous les équipements obligatoires sont OK avec bonne qté', async () => {
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, mockEventBus);

      const dto = {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [
          { equipmentTypeId: EQ_GILET,   ok: true, qty: 2 },
          { equipmentTypeId: EQ_LAMPE,   ok: true, qty: 1 },
          { equipmentTypeId: EQ_TROUSSE, ok: true, qty: 1 },
        ],
      };

      const result = await svc.createBriefing(TENANT_ID, dto);
      expect(result.allEquipmentOk).toBe(true);
      expect(result.missingEquipmentCodes).toHaveLength(0);
    });

    it('allEquipmentOk=false si un équipement obligatoire est absent', async () => {
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, mockEventBus);

      const dto = {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [
          // LAMPE manquante
          { equipmentTypeId: EQ_GILET,   ok: true, qty: 2 },
          { equipmentTypeId: EQ_TROUSSE, ok: true, qty: 1 },
        ],
      };

      const result = await svc.createBriefing(TENANT_ID, dto);
      expect(result.allEquipmentOk).toBe(false);
      expect(result.missingEquipmentCodes).toContain('LAMPE');
    });

    it('allEquipmentOk=false si un item est ok=false', async () => {
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, mockEventBus);

      const dto = {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [
          { equipmentTypeId: EQ_GILET,   ok: false, qty: 2 }, // ok=false
          { equipmentTypeId: EQ_LAMPE,   ok: true,  qty: 1 },
          { equipmentTypeId: EQ_TROUSSE, ok: true,  qty: 1 },
        ],
      };

      const result = await svc.createBriefing(TENANT_ID, dto);
      expect(result.allEquipmentOk).toBe(false);
      expect(result.missingEquipmentCodes).toContain('GILET');
    });

    it('allEquipmentOk=false si qty insuffisante', async () => {
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, mockEventBus);

      const dto = {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [
          { equipmentTypeId: EQ_GILET,   ok: true, qty: 1 }, // requis: 2
          { equipmentTypeId: EQ_LAMPE,   ok: true, qty: 1 },
          { equipmentTypeId: EQ_TROUSSE, ok: true, qty: 1 },
        ],
      };

      const result = await svc.createBriefing(TENANT_ID, dto);
      expect(result.allEquipmentOk).toBe(false);
      expect(result.missingEquipmentCodes).toContain('GILET');
    });

    it('recense plusieurs manquants dans missingEquipmentCodes', async () => {
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, mockEventBus);

      const result = await svc.createBriefing(TENANT_ID, {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [], // tous manquants
      });

      expect(result.allEquipmentOk).toBe(false);
      expect(result.missingEquipmentCodes).toEqual(
        expect.arrayContaining(['GILET', 'LAMPE', 'TROUSSE']),
      );
      expect(result.missingEquipmentCodes).toHaveLength(3);
    });

    it('publie l\'événement CREW_BRIEFING_COMPLETED si conforme', async () => {
      const publishSpy = jest.fn().mockResolvedValue(undefined);
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, { publish: publishSpy } as any);

      await svc.createBriefing(TENANT_ID, {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [
          { equipmentTypeId: EQ_GILET,   ok: true, qty: 2 },
          { equipmentTypeId: EQ_LAMPE,   ok: true, qty: 1 },
          { equipmentTypeId: EQ_TROUSSE, ok: true, qty: 1 },
        ],
      });

      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy.mock.calls[0][0].type).toBe('crew.briefing.completed');
    });

    it('publie CREW_BRIEFING_EQUIPMENT_MISSING si non conforme', async () => {
      const publishSpy = jest.fn().mockResolvedValue(undefined);
      const prisma = makePrisma();
      svc = new CrewBriefingService(prisma, { publish: publishSpy } as any);

      await svc.createBriefing(TENANT_ID, {
        assignmentId: ASSIGNMENT_ID,
        conductedById: CONDUCTED_BY,
        checkedItems: [],
      });

      expect(publishSpy.mock.calls[0][0].type).toBe('crew.briefing.equipment_missing');
    });
  });

  // ── Cas d'erreur ──────────────────────────────────────────────────────────────

  describe('createBriefing() — cas d\'erreur', () => {
    it('lève NotFoundException si assignment introuvable', async () => {
      const prisma = makePrisma({ assignment: null });
      svc = new CrewBriefingService(prisma, mockEventBus);

      await expect(
        svc.createBriefing(TENANT_ID, { assignmentId: 'unknown', conductedById: CONDUCTED_BY, checkedItems: [] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lève BadRequestException si briefing déjà existant pour cette assignment', async () => {
      const prisma = makePrisma({ existingBriefing: { id: 'existing-1' } });
      svc = new CrewBriefingService(prisma, mockEventBus);

      await expect(
        svc.createBriefing(TENANT_ID, {
          assignmentId: ASSIGNMENT_ID,
          conductedById: CONDUCTED_BY,
          checkedItems: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
