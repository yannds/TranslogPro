/**
 * Bus State Graph Specs
 *
 * Vérifie la topologie du workflow Bus (PRD §III.7) :
 *   - Constants BusState / BusAction
 *   - Transitions : IDLE→BOARDING→DEPARTED→ARRIVED→CLOSED
 *   - Branche maintenance : *→MAINTENANCE→AVAILABLE
 *   - Guards : checklist PRE_DEPARTURE (OPEN_BOARDING), manifest clos (DEPART)
 */

import { BadRequestException } from '@nestjs/common';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService } from '@core/workflow/audit.service';
import { PrismaService } from '@infra/database/prisma.service';
import { BusState, BusAction } from '@common/constants/workflow-states';
import { WorkflowEntity } from '@core/workflow/interfaces/workflow-entity.interface';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = 'tenant-bus-001';
const ACTOR  = { id: 'driver-01', tenantId: TENANT, roleId: 'role-driver', agencyId: 'agency-01', roleName: 'Driver' };

function makeBus(status: string, version = 1): WorkflowEntity {
  return { id: 'bus-001', tenantId: TENANT, status, version };
}

function makeWfConfig(fromState: string, action: string, toState: string) {
  return {
    id: 'wf-bus', tenantId: TENANT, entityType: 'Bus',
    fromState, action, toState,
    requiredPerm: 'data.bus.manage.agency',
    guards: [], sideEffects: [], version: 1, isActive: true, effectiveFrom: new Date(),
  };
}

function makePrisma(config: ReturnType<typeof makeWfConfig> | null): jest.Mocked<PrismaService> {
  return {
    workflowConfig:    { findFirst: jest.fn().mockResolvedValue(config) },
    rolePermission:    { findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.bus.manage.agency' }) },
    workflowTransition: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      workflowTransition: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn().mockResolvedValue({ idempotencyKey: 'k', toState: config?.toState ?? '', fromState: config?.fromState ?? '' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ version: 1 }]),
    } as unknown as PrismaService)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeAudit(): jest.Mocked<AuditService> {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
}

function makePersist() {
  return jest.fn().mockImplementation(async (entity: WorkflowEntity, toState: string) => ({
    ...entity, status: toState, version: entity.version + 1,
  }));
}

function buildEngine(fromState: string, action: string, toState: string): WorkflowEngine {
  return new WorkflowEngine(makePrisma(makeWfConfig(fromState, action, toState)), makeAudit());
}

async function runTransition(engine: WorkflowEngine, bus: WorkflowEntity, action: string, idem: string) {
  return engine.transition(bus, { action, actor: ACTOR, idempotencyKey: idem }, { aggregateType: 'Bus', persist: makePersist() });
}

// ─── Constantes ────────────────────────────────────────────────────────────────

describe('BusState — constantes', () => {
  it('chaque clé = sa valeur string', () => {
    for (const [k, v] of Object.entries(BusState)) {
      expect(v).toBe(k);
    }
  });

  it('contient les états PRD §III.7', () => {
    const required = ['AVAILABLE','IDLE','BOARDING','DEPARTED','ARRIVED','CLOSED','MAINTENANCE','OUT_OF_SERVICE'];
    for (const s of required) {
      expect(Object.values(BusState)).toContain(s);
    }
  });
});

describe('BusAction — constantes', () => {
  it('contient les actions PRD §III.7', () => {
    const required = ['OPEN_BOARDING','DEPART','ARRIVE','CLEAN','INCIDENT_MECHANICAL','RESTORE'];
    for (const a of required) {
      expect(Object.values(BusAction)).toContain(a);
    }
  });
});

// ─── WorkflowEngine — routage Bus ─────────────────────────────────────────────

describe('WorkflowEngine — Bus', () => {

  // ── Séquence principale ────────────────────────────────────────────────────

  describe('IDLE → BOARDING (OPEN_BOARDING)', () => {
    it('retourne toState=BOARDING', async () => {
      const engine = buildEngine('IDLE', BusAction.OPEN_BOARDING, 'BOARDING');
      const result = await runTransition(engine, makeBus('IDLE'), BusAction.OPEN_BOARDING, 'ob-01');
      expect(result.toState).toBe('BOARDING');
    });

    it('guard checklist PRE_DEPARTURE peut bloquer', async () => {
      const engine = buildEngine('IDLE', BusAction.OPEN_BOARDING, 'BOARDING');
      await expect(
        engine.transition(
          makeBus('IDLE'),
          { action: BusAction.OPEN_BOARDING, actor: ACTOR },
          {
            aggregateType: 'Bus',
            guards: [{ name: 'pre_departure_checklist', fn: jest.fn().mockResolvedValue(false) }],
            persist: makePersist(),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('BOARDING → DEPARTED (DEPART)', () => {
    it('retourne toState=DEPARTED', async () => {
      const engine = buildEngine('BOARDING', BusAction.DEPART, 'DEPARTED');
      const result = await runTransition(engine, makeBus('BOARDING'), BusAction.DEPART, 'dep-01');
      expect(result.toState).toBe('DEPARTED');
    });

    it('guard manifest clos peut bloquer le DEPART', async () => {
      const engine = buildEngine('BOARDING', BusAction.DEPART, 'DEPARTED');
      await expect(
        engine.transition(
          makeBus('BOARDING'),
          { action: BusAction.DEPART, actor: ACTOR },
          {
            aggregateType: 'Bus',
            guards: [{ name: 'manifest_closed', fn: jest.fn().mockResolvedValue(false) }],
            persist: makePersist(),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('DEPARTED → ARRIVED (ARRIVE)', () => {
    it('retourne toState=ARRIVED', async () => {
      const engine = buildEngine('DEPARTED', BusAction.ARRIVE, 'ARRIVED');
      const result = await runTransition(engine, makeBus('DEPARTED'), BusAction.ARRIVE, 'arr-01');
      expect(result.toState).toBe('ARRIVED');
    });
  });

  describe('ARRIVED → CLOSED (CLEAN)', () => {
    it('retourne toState=CLOSED après checklist POST_TRIP', async () => {
      const engine = buildEngine('ARRIVED', BusAction.CLEAN, 'CLOSED');
      const result = await runTransition(engine, makeBus('ARRIVED'), BusAction.CLEAN, 'clean-01');
      expect(result.toState).toBe('CLOSED');
    });
  });

  // ── Branche maintenance ────────────────────────────────────────────────────

  describe('* → MAINTENANCE (INCIDENT_MECHANICAL)', () => {
    it('depuis BOARDING → MAINTENANCE', async () => {
      const engine = buildEngine('BOARDING', BusAction.INCIDENT_MECHANICAL, 'MAINTENANCE');
      const result = await runTransition(engine, makeBus('BOARDING'), BusAction.INCIDENT_MECHANICAL, 'maint-01');
      expect(result.toState).toBe('MAINTENANCE');
    });

    it('depuis DEPARTED → MAINTENANCE', async () => {
      const engine = buildEngine('DEPARTED', BusAction.INCIDENT_MECHANICAL, 'MAINTENANCE');
      const result = await runTransition(engine, makeBus('DEPARTED'), BusAction.INCIDENT_MECHANICAL, 'maint-02');
      expect(result.toState).toBe('MAINTENANCE');
    });
  });

  describe('MAINTENANCE → AVAILABLE (RESTORE)', () => {
    it('retourne toState=AVAILABLE après approbation', async () => {
      const engine = buildEngine('MAINTENANCE', BusAction.RESTORE, 'AVAILABLE');
      const result = await runTransition(engine, makeBus('MAINTENANCE'), BusAction.RESTORE, 'restore-01');
      expect(result.toState).toBe('AVAILABLE');
    });

    it('guard approve peut bloquer la restauration', async () => {
      const engine = buildEngine('MAINTENANCE', BusAction.RESTORE, 'AVAILABLE');
      await expect(
        engine.transition(
          makeBus('MAINTENANCE'),
          { action: BusAction.RESTORE, actor: ACTOR },
          {
            aggregateType: 'Bus',
            guards: [{ name: 'maintenance_approved', fn: jest.fn().mockResolvedValue(false) }],
            persist: makePersist(),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Transition bloquée ──────────────────────────────────────────────────────

  describe('Transition interdite', () => {
    it('lève BadRequestException si aucune config pour (CLOSED, DEPART)', async () => {
      const engine = new WorkflowEngine(makePrisma(null), makeAudit());
      await expect(
        runTransition(engine, makeBus('CLOSED'), BusAction.DEPART, 'bad-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
