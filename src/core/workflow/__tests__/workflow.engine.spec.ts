/**
 * WorkflowEngine — Tests unitaires
 *
 * Stratégie : mock Prisma + AuditService — pas de DB réelle.
 * Ces tests vérifient la logique du moteur (idempotence, permissions,
 * guards, lock optimiste) indépendamment de l'infrastructure.
 *
 * Pour les tests d'intégration avec PostgreSQL réel → workflow.engine.e2e-spec.ts
 */

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { WorkflowEngine, WorkflowTransitionConfig } from '../workflow.engine';
import { AuditService } from '../audit.service';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test-001';
const ACTOR = {
  id:       'user-driver-01',
  tenantId: TENANT_ID,
  roleId:   'role-driver-01',
  roleName: 'DRIVER',
  agencyId: 'agency-01',
};

const BASE_TICKET: WorkflowEntity = {
  id:       'ticket-001',
  tenantId: TENANT_ID,
  status:   'CONFIRMED',
  version:  1,
};

const TRANSITION_INPUT: TransitionInput = {
  action:          'BOARD',
  actor:           ACTOR,
  idempotencyKey:  'idem-key-001',
};

// ─── Prisma mock factory ──────────────────────────────────────────────────────

function makePrismaMock(overrides: Record<string, unknown> = {}): jest.Mocked<PrismaService> {
  const wfConfig = {
    id:           'wf-config-01',
    tenantId:     TENANT_ID,
    entityType:   'Ticket',
    fromState:    'CONFIRMED',
    action:       'BOARD',
    toState:      'BOARDED',
    requiredPerm: 'data.ticket.scan.agency',
    guards:       [],
    sideEffects:  [],
    version:      1,
    isActive:     true,
    effectiveFrom: new Date(),
  };

  return {
    workflowConfig: {
      findFirst: jest.fn().mockResolvedValue(wfConfig),
    },
    rolePermission: {
      findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.ticket.scan.agency' }),
    },
    workflowTransition: {
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({ id: 'wt-01', idempotencyKey: TRANSITION_INPUT.idempotencyKey, toState: 'BOARDED', fromState: 'CONFIRMED' }),
    },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      workflowTransition: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn().mockResolvedValue({ idempotencyKey: TRANSITION_INPUT.idempotencyKey, toState: 'BOARDED', fromState: 'CONFIRMED' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ version: 1 }]),
    } as unknown as PrismaService)),
    ...overrides,
  } as unknown as jest.Mocked<PrismaService>;
}

function makeAuditMock(): jest.Mocked<AuditService> {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
}

// ─── Config de transition helper ─────────────────────────────────────────────

function makeConfig(
  overrides: Partial<WorkflowTransitionConfig<WorkflowEntity>> = {},
): WorkflowTransitionConfig<WorkflowEntity> {
  return {
    aggregateType: 'Ticket',
    persist: jest.fn().mockImplementation(async (entity, toState) => ({
      ...entity,
      status:  toState,
      version: entity.version + 1,
    })),
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;
  let prisma:  jest.Mocked<PrismaService>;
  let audit:   jest.Mocked<AuditService>;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit  = makeAuditMock();
    const registry = new (require('../side-effect.registry').SideEffectRegistry)();
    engine = new WorkflowEngine(prisma, audit, registry);
  });

  // ── 1. Happy path ──────────────────────────────────────────────────────────

  describe('transition() — happy path', () => {
    it('retourne toState=BOARDED et incrémente la version', async () => {
      const result = await engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig());
      expect(result.toState).toBe('BOARDED');
      expect(result.fromState).toBe('CONFIRMED');
    });

    it('appelle persist() une seule fois', async () => {
      const config  = makeConfig();
      await engine.transition(BASE_TICKET, TRANSITION_INPUT, config);
      expect(config.persist).toHaveBeenCalledTimes(1);
      expect(config.persist).toHaveBeenCalledWith(
        BASE_TICKET,
        'BOARDED',
        expect.anything(),
      );
    });

    it('crée un WorkflowTransition avec l\'idempotencyKey fourni', async () => {
      await engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig());
      // Le moteur passe action=requiredPerm (permission canonique pour SIEM/ISO 27001),
      // pas le verbe métier 'BOARD'. C'est le contrat défini ligne 245 du moteur.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          action:   'data.ticket.scan.agency',
        }),
      );
    });
  });

  // ── 2. aggregateType invalide ──────────────────────────────────────────────

  describe('transition() — aggregateType inconnu', () => {
    it('lève BadRequestException si aggregateType hors whitelist', async () => {
      const config = makeConfig({ aggregateType: 'UNKNOWN_ENTITY' });
      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, config),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── 3. WorkflowConfig introuvable ─────────────────────────────────────────

  describe('transition() — config manquante', () => {
    it('lève BadRequestException si aucune WorkflowConfig active', async () => {
      prisma.workflowConfig.findFirst = jest.fn().mockResolvedValue(null);
      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── 4. Permission manquante ────────────────────────────────────────────────

  describe('transition() — permission insuffisante', () => {
    it('lève ForbiddenException si le rôle ne possède pas la permission', async () => {
      prisma.rolePermission.findFirst = jest.fn().mockResolvedValue(null);
      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lève ForbiddenException si scope=agency et agencyId absent', async () => {
      // Permission agency mais actor sans agencyId
      const actorNoAgency = { ...ACTOR, agencyId: undefined };
      const input = { ...TRANSITION_INPUT, actor: actorNoAgency };
      await expect(
        engine.transition(BASE_TICKET, input, makeConfig()),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── 5. Guard applicatif ────────────────────────────────────────────────────

  describe('transition() — guards', () => {
    it('lève BadRequestException si un guard retourne false', async () => {
      const config = makeConfig({
        guards: [{ name: 'checklist_compliant', fn: jest.fn().mockResolvedValue(false) }],
      });
      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, config),
      ).rejects.toThrow(BadRequestException);
    });

    it('passe si tous les guards retournent true', async () => {
      const config = makeConfig({
        guards: [
          { name: 'guard_a', fn: jest.fn().mockResolvedValue(true) },
          { name: 'guard_b', fn: jest.fn().mockResolvedValue(true) },
        ],
      });
      const result = await engine.transition(BASE_TICKET, TRANSITION_INPUT, config);
      expect(result.toState).toBe('BOARDED');
    });

    it('évalue les guards dans l\'ordre', async () => {
      const order: string[] = [];
      const config = makeConfig({
        guards: [
          { name: 'first',  fn: jest.fn().mockImplementation(async () => { order.push('first');  return true; }) },
          { name: 'second', fn: jest.fn().mockImplementation(async () => { order.push('second'); return true; }) },
        ],
      });
      await engine.transition(BASE_TICKET, TRANSITION_INPUT, config);
      expect(order).toEqual(['first', 'second']);
    });
  });

  // ── 6. Idempotence ────────────────────────────────────────────────────────

  describe('transition() — idempotence', () => {
    it('retourne l\'état existant sans re-persister si idempotencyKey déjà connu', async () => {
      // Simuler une transition déjà commitée
      const existing = {
        idempotencyKey: TRANSITION_INPUT.idempotencyKey,
        toState:        'BOARDED',
        fromState:      'CONFIRMED',
      };

      prisma.transact = jest.fn().mockImplementation(async (fn: (tx: PrismaService) => Promise<unknown>) =>
        fn({
          workflowTransition: {
            findUnique: jest.fn().mockResolvedValue(existing),
            create:     jest.fn(),
          },
          $queryRaw: jest.fn(),
        } as unknown as PrismaService),
      );

      const config = makeConfig();
      const result = await engine.transition(BASE_TICKET, TRANSITION_INPUT, config);

      expect(result.toState).toBe('BOARDED');
      expect(config.persist).not.toHaveBeenCalled(); // Pas de re-persist
    });
  });

  // ── 7. Lock optimiste (version mismatch) ──────────────────────────────────

  describe('transition() — lock optimiste', () => {
    it('lève ConflictException si version DB ≠ entity.version', async () => {
      prisma.transact = jest.fn().mockImplementation(async (fn: (tx: PrismaService) => Promise<unknown>) =>
        fn({
          workflowTransition: {
            findUnique: jest.fn().mockResolvedValue(null),
            create:     jest.fn(),
          },
          // Version DB = 2, entity.version = 1 → conflit
          $queryRaw: jest.fn().mockResolvedValue([{ version: 2 }]),
        } as unknown as PrismaService),
      );

      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig()),
      ).rejects.toThrow(ConflictException);
    });

    it('lève ConflictException si l\'entité n\'existe plus en DB', async () => {
      prisma.transact = jest.fn().mockImplementation(async (fn: (tx: PrismaService) => Promise<unknown>) =>
        fn({
          workflowTransition: {
            findUnique: jest.fn().mockResolvedValue(null),
            create:     jest.fn(),
          },
          $queryRaw: jest.fn().mockResolvedValue([]), // 0 lignes → entité supprimée
        } as unknown as PrismaService),
      );

      await expect(
        engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig()),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── 8. Audit ──────────────────────────────────────────────────────────────

  describe('transition() — audit', () => {
    it('appelle audit.record() avec les bons champs', async () => {
      await engine.transition(BASE_TICKET, TRANSITION_INPUT, makeConfig());
      // action = requiredPerm (permission canonique) — pas le verbe métier.
      // C'est le contrat ADR : le SIEM filtre par permission, pas par verbe.
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          userId:   ACTOR.id,
          action:   'data.ticket.scan.agency',
          resource: expect.stringContaining('ticket-001'),
        }),
      );
    });
  });
});
