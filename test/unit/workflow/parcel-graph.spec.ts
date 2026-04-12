/**
 * Parcel State Graph Specs
 *
 * Vérifie la topologie du workflow Colis (8 états, PRD §III.7) :
 *   - Constants ParcelState / ParcelAction
 *   - Transitions : CREATED→AT_ORIGIN→PACKED→LOADED→IN_TRANSIT→ARRIVED→DELIVERED
 *   - Cas exceptionnels : DAMAGE, DECLARE_LOST, RETURN
 */

import { BadRequestException } from '@nestjs/common';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService } from '@core/workflow/audit.service';
import { PrismaService } from '@infra/database/prisma.service';
import { ParcelState, ParcelAction } from '@common/constants/workflow-states';
import { WorkflowEntity } from '@core/workflow/interfaces/workflow-entity.interface';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = 'tenant-parcel-001';
const ACTOR  = { id: 'agent-01', tenantId: TENANT, roleId: 'role-agent', agencyId: 'agency-01', roleName: 'Agent' };

function makeParcel(status: string, version = 1): WorkflowEntity {
  return { id: 'parcel-001', tenantId: TENANT, status, version };
}

function makeWfConfig(fromState: string, action: string, toState: string) {
  return {
    id: 'wf-parcel', tenantId: TENANT, entityType: 'Parcel',
    fromState, action, toState,
    requiredPerm: 'data.parcel.manage.agency',
    guards: [], sideEffects: [], version: 1, isActive: true, effectiveFrom: new Date(),
  };
}

function makePrisma(config: ReturnType<typeof makeWfConfig> | null): jest.Mocked<PrismaService> {
  return {
    workflowConfig:    { findFirst: jest.fn().mockResolvedValue(config) },
    rolePermission:    { findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.parcel.manage.agency' }) },
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

function runTransition(engine: WorkflowEngine, parcel: WorkflowEntity, action: string, idem: string) {
  return engine.transition(parcel, { action, actor: ACTOR, idempotencyKey: idem }, { aggregateType: 'Parcel', persist: makePersist() });
}

// ─── Constantes ────────────────────────────────────────────────────────────────

describe('ParcelState — constantes', () => {
  it('chaque clé = sa valeur string', () => {
    for (const [k, v] of Object.entries(ParcelState)) {
      expect(v).toBe(k);
    }
  });

  it('contient les 10 états du PRD §III.7', () => {
    const required = ['CREATED','AT_ORIGIN','PACKED','LOADED','IN_TRANSIT','ARRIVED','DELIVERED','DAMAGED','LOST','RETURNED'];
    for (const s of required) {
      expect(Object.values(ParcelState)).toContain(s);
    }
  });
});

describe('ParcelAction — constantes', () => {
  it('contient les actions du PRD §III.7', () => {
    const required = ['PACK','RECEIVE','ADD_TO_SHIPMENT','LOAD','DEPART','ARRIVE','DELIVER','DAMAGE','DECLARE_LOST','RETURN'];
    for (const a of required) {
      expect(Object.values(ParcelAction)).toContain(a);
    }
  });
});

// ─── WorkflowEngine — routage Parcel ──────────────────────────────────────────

describe('WorkflowEngine — Parcel', () => {

  // ── Séquence principale ────────────────────────────────────────────────────

  describe('CREATED → AT_ORIGIN (RECEIVE)', () => {
    it('retourne toState=AT_ORIGIN', async () => {
      const engine = buildEngine('CREATED', ParcelAction.RECEIVE, 'AT_ORIGIN');
      const result = await runTransition(engine, makeParcel('CREATED'), ParcelAction.RECEIVE, 'rcv-01');
      expect(result.toState).toBe('AT_ORIGIN');
      expect(result.fromState).toBe('CREATED');
    });
  });

  describe('AT_ORIGIN → PACKED (ADD_TO_SHIPMENT)', () => {
    it('retourne toState=PACKED', async () => {
      const engine = buildEngine('AT_ORIGIN', ParcelAction.ADD_TO_SHIPMENT, 'PACKED');
      const result = await runTransition(engine, makeParcel('AT_ORIGIN'), ParcelAction.ADD_TO_SHIPMENT, 'pack-01');
      expect(result.toState).toBe('PACKED');
    });

    it('guard poids+destination peut bloquer la transition', async () => {
      const engine = buildEngine('AT_ORIGIN', ParcelAction.ADD_TO_SHIPMENT, 'PACKED');
      await expect(
        engine.transition(
          makeParcel('AT_ORIGIN'),
          { action: ParcelAction.ADD_TO_SHIPMENT, actor: ACTOR },
          {
            aggregateType: 'Parcel',
            guards: [{ name: 'weight_check', fn: jest.fn().mockResolvedValue(false) }],
            persist: makePersist(),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('PACKED → LOADED (LOAD)', () => {
    it('retourne toState=LOADED', async () => {
      const engine = buildEngine('PACKED', ParcelAction.LOAD, 'LOADED');
      const result = await runTransition(engine, makeParcel('PACKED'), ParcelAction.LOAD, 'load-01');
      expect(result.toState).toBe('LOADED');
    });
  });

  describe('LOADED → IN_TRANSIT (DEPART)', () => {
    it('retourne toState=IN_TRANSIT', async () => {
      const engine = buildEngine('LOADED', ParcelAction.DEPART, 'IN_TRANSIT');
      const result = await runTransition(engine, makeParcel('LOADED'), ParcelAction.DEPART, 'dep-01');
      expect(result.toState).toBe('IN_TRANSIT');
    });
  });

  describe('IN_TRANSIT → ARRIVED (ARRIVE)', () => {
    it('retourne toState=ARRIVED', async () => {
      const engine = buildEngine('IN_TRANSIT', ParcelAction.ARRIVE, 'ARRIVED');
      const result = await runTransition(engine, makeParcel('IN_TRANSIT'), ParcelAction.ARRIVE, 'arr-01');
      expect(result.toState).toBe('ARRIVED');
    });
  });

  describe('ARRIVED → DELIVERED (DELIVER)', () => {
    it('retourne toState=DELIVERED', async () => {
      const engine = buildEngine('ARRIVED', ParcelAction.DELIVER, 'DELIVERED');
      const result = await runTransition(engine, makeParcel('ARRIVED'), ParcelAction.DELIVER, 'del-01');
      expect(result.toState).toBe('DELIVERED');
    });
  });

  // ── Cas exceptionnels ──────────────────────────────────────────────────────

  describe('DAMAGE → DAMAGED (depuis tout état en transit)', () => {
    it('retourne toState=DAMAGED depuis IN_TRANSIT', async () => {
      const engine = buildEngine('IN_TRANSIT', ParcelAction.DAMAGE, 'DAMAGED');
      const result = await runTransition(engine, makeParcel('IN_TRANSIT'), ParcelAction.DAMAGE, 'dmg-01');
      expect(result.toState).toBe('DAMAGED');
    });
  });

  describe('DECLARE_LOST → LOST', () => {
    it('retourne toState=LOST', async () => {
      const engine = buildEngine('IN_TRANSIT', ParcelAction.DECLARE_LOST, 'LOST');
      const result = await runTransition(engine, makeParcel('IN_TRANSIT'), ParcelAction.DECLARE_LOST, 'lost-01');
      expect(result.toState).toBe('LOST');
    });
  });

  describe('RETURN → RETURNED', () => {
    it('retourne toState=RETURNED', async () => {
      const engine = buildEngine('ARRIVED', ParcelAction.RETURN, 'RETURNED');
      const result = await runTransition(engine, makeParcel('ARRIVED'), ParcelAction.RETURN, 'ret-01');
      expect(result.toState).toBe('RETURNED');
    });
  });

  // ── Transition bloquée ──────────────────────────────────────────────────────

  describe('Transition interdite', () => {
    it('lève BadRequestException si aucune config pour (DELIVERED, RECEIVE)', async () => {
      const engine = new WorkflowEngine(makePrisma(null), makeAudit());
      await expect(
        runTransition(engine, makeParcel('DELIVERED'), ParcelAction.RECEIVE, 'bad-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
