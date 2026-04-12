/**
 * Ticket State Graph Specs
 *
 * Vérifie la topologie du workflow Ticket :
 *   - Constants d'état et d'action bien définis
 *   - WorkflowEngine route correctement Ticket (whitelist)
 *   - Transitions clés : PENDING_PAYMENT→CONFIRMED, CONFIRMED→BOARDED, expiré, remboursement
 *
 * Stratégie : mock Prisma + AuditService — aucune DB.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { AuditService } from '@core/workflow/audit.service';
import { PrismaService } from '@infra/database/prisma.service';
import { TicketState, TicketAction } from '@common/constants/workflow-states';
import { WorkflowEntity } from '@core/workflow/interfaces/workflow-entity.interface';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-tc-001';
const ACTOR  = { id: 'user-01', tenantId: TENANT, roleId: 'role-cashier', agencyId: 'agency-01', roleName: 'Cashier' };

function makeTicket(status: string, version = 1): WorkflowEntity {
  return { id: 'ticket-001', tenantId: TENANT, status, version };
}

function makeWfConfig(fromState: string, action: string, toState: string) {
  return {
    id: 'wf-01', tenantId: TENANT, entityType: 'Ticket',
    fromState, action, toState,
    requiredPerm: 'data.ticket.scan.agency',
    guards: [], sideEffects: [], version: 1, isActive: true, effectiveFrom: new Date(),
  };
}

function makePrisma(config: ReturnType<typeof makeWfConfig> | null = null): jest.Mocked<PrismaService> {
  return {
    workflowConfig:    { findFirst: jest.fn().mockResolvedValue(config) },
    rolePermission:    { findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.ticket.scan.agency' }) },
    workflowTransition: {
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({ idempotencyKey: 'k', toState: config?.toState ?? '', fromState: config?.fromState ?? '' }),
    },
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

// ─── Constantes ────────────────────────────────────────────────────────────────

describe('TicketState — constantes', () => {
  it('chaque clé correspond à sa valeur string', () => {
    const states = Object.entries(TicketState) as [string, string][];
    for (const [k, v] of states) {
      expect(v).toBe(k);
    }
  });

  it('contient les états obligatoires du PRD §III.7', () => {
    expect(TicketState.CREATED).toBe('CREATED');
    expect(TicketState.PENDING_PAYMENT).toBe('PENDING_PAYMENT');
    expect(TicketState.CONFIRMED).toBe('CONFIRMED');
    expect(TicketState.BOARDED).toBe('BOARDED');
    expect(TicketState.COMPLETED).toBe('COMPLETED');
    expect(TicketState.CANCELLED).toBe('CANCELLED');
    expect(TicketState.EXPIRED).toBe('EXPIRED');
    expect(TicketState.REFUNDED).toBe('REFUNDED');
  });
});

describe('TicketAction — constantes', () => {
  it('chaque action est une chaîne non vide', () => {
    for (const v of Object.values(TicketAction)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });

  it('contient les actions obligatoires du PRD §III.7', () => {
    expect(TicketAction.PAY).toBe('PAY');
    expect(TicketAction.BOARD).toBe('BOARD');
    expect(TicketAction.CANCEL).toBe('CANCEL');
    expect(TicketAction.EXPIRE).toBe('EXPIRE');
    expect(TicketAction.REFUND).toBe('REFUND');
  });
});

// ─── WorkflowEngine — routage Ticket ──────────────────────────────────────────

describe('WorkflowEngine — Ticket', () => {
  let engine: WorkflowEngine;

  // ── Transition PENDING_PAYMENT → CONFIRMED (PAY) ────────────────────────────

  describe('PAY : PENDING_PAYMENT → CONFIRMED', () => {
    beforeEach(() => {
      engine = new WorkflowEngine(
        makePrisma(makeWfConfig('PENDING_PAYMENT', 'PAY', 'CONFIRMED')),
        makeAudit(),
      );
    });

    it('retourne toState=CONFIRMED', async () => {
      const result = await engine.transition(
        makeTicket('PENDING_PAYMENT'),
        { action: TicketAction.PAY, actor: ACTOR, idempotencyKey: 'idem-pay-01' },
        { aggregateType: 'Ticket', persist: makePersist() },
      );
      expect(result.toState).toBe('CONFIRMED');
      expect(result.fromState).toBe('PENDING_PAYMENT');
    });

    it('appelle persist() exactement une fois', async () => {
      const persist = makePersist();
      await engine.transition(
        makeTicket('PENDING_PAYMENT'),
        { action: TicketAction.PAY, actor: ACTOR, idempotencyKey: 'idem-pay-02' },
        { aggregateType: 'Ticket', persist },
      );
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  // ── Transition CONFIRMED → BOARDED (BOARD) ─────────────────────────────────

  describe('BOARD : CONFIRMED → BOARDED', () => {
    beforeEach(() => {
      engine = new WorkflowEngine(
        makePrisma(makeWfConfig('CONFIRMED', 'BOARD', 'BOARDED')),
        makeAudit(),
      );
    });

    it('retourne toState=BOARDED', async () => {
      const result = await engine.transition(
        makeTicket('CONFIRMED'),
        { action: TicketAction.BOARD, actor: ACTOR, idempotencyKey: 'idem-board-01' },
        { aggregateType: 'Ticket', persist: makePersist() },
      );
      expect(result.toState).toBe('BOARDED');
    });
  });

  // ── Transition CONFIRMED → CANCELLED (CANCEL) ──────────────────────────────

  describe('CANCEL : CONFIRMED → CANCELLED', () => {
    beforeEach(() => {
      engine = new WorkflowEngine(
        makePrisma(makeWfConfig('CONFIRMED', 'CANCEL', 'CANCELLED')),
        makeAudit(),
      );
    });

    it('retourne toState=CANCELLED', async () => {
      const result = await engine.transition(
        makeTicket('CONFIRMED'),
        { action: TicketAction.CANCEL, actor: ACTOR, idempotencyKey: 'idem-cancel-01' },
        { aggregateType: 'Ticket', persist: makePersist() },
      );
      expect(result.toState).toBe('CANCELLED');
    });
  });

  // ── Transition bloquée (aucune WorkflowConfig) ─────────────────────────────

  describe('Transition interdite', () => {
    beforeEach(() => {
      engine = new WorkflowEngine(makePrisma(null), makeAudit());
    });

    it('lève BadRequestException si aucune config active pour ce (state, action)', async () => {
      await expect(
        engine.transition(
          makeTicket('BOARDED'),                          // état terminal — BOARD depuis BOARDED inexistant
          { action: TicketAction.BOARD, actor: ACTOR },
          { aggregateType: 'Ticket', persist: makePersist() },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Permission manquante ────────────────────────────────────────────────────

  describe('Permission insuffisante', () => {
    it("lève ForbiddenException si le rôle n'a pas la permission", async () => {
      const prisma = makePrisma(makeWfConfig('CONFIRMED', 'BOARD', 'BOARDED'));
      prisma.rolePermission.findFirst = jest.fn().mockResolvedValue(null);
      engine = new WorkflowEngine(prisma, makeAudit());

      await expect(
        engine.transition(
          makeTicket('CONFIRMED'),
          { action: TicketAction.BOARD, actor: ACTOR },
          { aggregateType: 'Ticket', persist: makePersist() },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── Guard expiry ────────────────────────────────────────────────────────────

  describe('Guard : ticket expiré', () => {
    it("lève BadRequestException si le guard d'expiration retourne false", async () => {
      engine = new WorkflowEngine(
        makePrisma(makeWfConfig('PENDING_PAYMENT', 'PAY', 'CONFIRMED')),
        makeAudit(),
      );

      await expect(
        engine.transition(
          makeTicket('PENDING_PAYMENT'),
          { action: TicketAction.PAY, actor: ACTOR },
          {
            aggregateType: 'Ticket',
            guards: [{ name: 'not_expired', fn: jest.fn().mockResolvedValue(false) }],
            persist: makePersist(),
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
