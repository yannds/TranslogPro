/**
 * Trip State Graph Specs
 *
 * Vérifie la topologie du workflow Trip :
 *   - Constants TripState / TripAction
 *   - Transitions principales : PLANNED→OPEN→BOARDING→IN_PROGRESS→COMPLETED
 *   - Branches : PAUSE/RESUME, REPORT_INCIDENT/CLEAR_INCIDENT, CANCEL
 */

import { BadRequestException } from '@nestjs/common';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService } from '@core/workflow/audit.service';
import { PrismaService } from '@infra/database/prisma.service';
import { TripState, TripAction } from '@common/constants/workflow-states';
import { WorkflowEntity } from '@core/workflow/interfaces/workflow-entity.interface';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TENANT = 'tenant-trip-001';
const ACTOR  = { id: 'driver-01', tenantId: TENANT, roleId: 'role-driver', agencyId: 'agency-01', roleName: 'Driver' };

function makeTrip(status: string, version = 1): WorkflowEntity {
  return { id: 'trip-001', tenantId: TENANT, status, version };
}

function makeWfConfig(fromState: string, action: string, toState: string) {
  return {
    id: 'wf-01', tenantId: TENANT, entityType: 'Trip',
    fromState, action, toState,
    requiredPerm: 'data.trip.manage.agency',
    guards: [], sideEffects: [], version: 1, isActive: true, effectiveFrom: new Date(),
  };
}

function makePrisma(config: ReturnType<typeof makeWfConfig> | null): jest.Mocked<PrismaService> {
  return {
    workflowConfig:    { findFirst: jest.fn().mockResolvedValue(config) },
    rolePermission:    { findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.trip.manage.agency' }) },
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

// ─── Constantes ────────────────────────────────────────────────────────────────

describe('TripState — constantes', () => {
  it('chaque clé = sa valeur string', () => {
    for (const [k, v] of Object.entries(TripState)) {
      expect(v).toBe(k);
    }
  });

  it('contient les 7 états du PRD §III.7', () => {
    const required = ['PLANNED','OPEN','BOARDING','IN_PROGRESS','IN_PROGRESS_PAUSED','IN_PROGRESS_DELAYED','COMPLETED','CANCELLED'];
    for (const s of required) {
      expect(Object.values(TripState)).toContain(s);
    }
  });
});

describe('TripAction — constantes', () => {
  it('contient les actions du PRD §III.7', () => {
    const required = ['ACTIVATE','START_BOARDING','DEPART','PAUSE','RESUME','REPORT_INCIDENT','CLEAR_INCIDENT','END_TRIP','CANCEL'];
    for (const a of required) {
      expect(Object.values(TripAction)).toContain(a);
    }
  });
});

// ─── WorkflowEngine — routage Trip ────────────────────────────────────────────

describe('WorkflowEngine — Trip', () => {
  const perm = { aggregateType: 'Trip' as const, persist: makePersist() };

  // ── Séquence principale ────────────────────────────────────────────────────

  describe('PLANNED → OPEN (ACTIVATE)', () => {
    it('retourne toState=OPEN', async () => {
      const engine = buildEngine('PLANNED', TripAction.ACTIVATE, 'OPEN');
      const result = await engine.transition(
        makeTrip('PLANNED'),
        { action: TripAction.ACTIVATE, actor: ACTOR, idempotencyKey: 'act-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('OPEN');
    });
  });

  describe('OPEN → BOARDING (START_BOARDING)', () => {
    it('retourne toState=BOARDING', async () => {
      const engine = buildEngine('OPEN', TripAction.START_BOARDING, 'BOARDING');
      const result = await engine.transition(
        makeTrip('OPEN'),
        { action: TripAction.START_BOARDING, actor: ACTOR, idempotencyKey: 'sb-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('BOARDING');
    });
  });

  describe('BOARDING → IN_PROGRESS (DEPART)', () => {
    it('retourne toState=IN_PROGRESS', async () => {
      const engine = buildEngine('BOARDING', TripAction.DEPART, 'IN_PROGRESS');
      const result = await engine.transition(
        makeTrip('BOARDING'),
        { action: TripAction.DEPART, actor: ACTOR, idempotencyKey: 'dep-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('IN_PROGRESS');
    });
  });

  describe('IN_PROGRESS → COMPLETED (END_TRIP)', () => {
    it('retourne toState=COMPLETED', async () => {
      const engine = buildEngine('IN_PROGRESS', TripAction.END_TRIP, 'COMPLETED');
      const result = await engine.transition(
        makeTrip('IN_PROGRESS'),
        { action: TripAction.END_TRIP, actor: ACTOR, idempotencyKey: 'end-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('COMPLETED');
    });
  });

  // ── Branche PAUSE / RESUME ─────────────────────────────────────────────────

  describe('IN_PROGRESS → IN_PROGRESS_PAUSED (PAUSE)', () => {
    it('retourne toState=IN_PROGRESS_PAUSED', async () => {
      const engine = buildEngine('IN_PROGRESS', TripAction.PAUSE, 'IN_PROGRESS_PAUSED');
      const result = await engine.transition(
        makeTrip('IN_PROGRESS'),
        { action: TripAction.PAUSE, actor: ACTOR, idempotencyKey: 'pause-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('IN_PROGRESS_PAUSED');
    });
  });

  describe('IN_PROGRESS_PAUSED → IN_PROGRESS (RESUME)', () => {
    it('retourne toState=IN_PROGRESS', async () => {
      const engine = buildEngine('IN_PROGRESS_PAUSED', TripAction.RESUME, 'IN_PROGRESS');
      const result = await engine.transition(
        makeTrip('IN_PROGRESS_PAUSED'),
        { action: TripAction.RESUME, actor: ACTOR, idempotencyKey: 'resume-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('IN_PROGRESS');
    });
  });

  // ── Branche INCIDENT ────────────────────────────────────────────────────────

  describe('IN_PROGRESS → IN_PROGRESS_DELAYED (REPORT_INCIDENT)', () => {
    it('retourne toState=IN_PROGRESS_DELAYED', async () => {
      const engine = buildEngine('IN_PROGRESS', TripAction.REPORT_INCIDENT, 'IN_PROGRESS_DELAYED');
      const result = await engine.transition(
        makeTrip('IN_PROGRESS'),
        { action: TripAction.REPORT_INCIDENT, actor: ACTOR, idempotencyKey: 'inc-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('IN_PROGRESS_DELAYED');
    });
  });

  // ── Annulation ──────────────────────────────────────────────────────────────

  describe('PLANNED → CANCELLED (CANCEL)', () => {
    it('retourne toState=CANCELLED', async () => {
      const engine = buildEngine('PLANNED', TripAction.CANCEL, 'CANCELLED');
      const result = await engine.transition(
        makeTrip('PLANNED'),
        { action: TripAction.CANCEL, actor: ACTOR, idempotencyKey: 'cancel-01' },
        { aggregateType: 'Trip', persist: makePersist() },
      );
      expect(result.toState).toBe('CANCELLED');
    });
  });

  // ── Transition bloquée ──────────────────────────────────────────────────────

  describe('Transition interdite', () => {
    it('lève BadRequestException si aucune WorkflowConfig active', async () => {
      const engine = new WorkflowEngine(makePrisma(null), makeAudit());
      await expect(
        engine.transition(
          makeTrip('COMPLETED'),
          { action: TripAction.DEPART, actor: ACTOR },
          { aggregateType: 'Trip', persist: makePersist() },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
