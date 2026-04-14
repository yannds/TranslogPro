/**
 * WorkflowStudioService — Tests unitaires
 *
 * Stratégie : PrismaService mocké.
 * Tests centrés sur :
 *   - simulateWorkflow() : chemins complets, transitions bloquées, permissions
 *   - createBlueprint()  : validation graphe, slug unique
 *   - saveTenantGraph()  : validation + désactivation + recréation
 *   - getBlueprint()     : blueprint non trouvé → NotFoundException
 *   - deleteBlueprint()  : blueprint système → ForbiddenException
 */

import {
  NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { WorkflowStudioService } from '../workflow-studio.service';
import { PrismaService }         from '../../../infrastructure/database/prisma.service';

// ─── Constantes ────────────────────────────────────────────────────────────────

const TENANT_ID    = 'tenant-1';
const ACTOR_ID     = 'user-1';
const BLUEPRINT_ID = 'bp-001';

// Graphe minimal valide : DRAFT → CONFIRMED → DONE
const MINIMAL_GRAPH_DTO = {
  entityType: 'Ticket',
  nodes: [
    { id: 'DRAFT',     label: 'Brouillon',  type: 'initial'  as const },
    { id: 'CONFIRMED', label: 'Confirmé',   type: 'state'    as const },
    { id: 'DONE',      label: 'Terminé',    type: 'terminal' as const },
  ],
  edges: [
    {
      id:          'e1',
      source:      'DRAFT',
      target:      'CONFIRMED',
      label:       'confirm',
      guards:      [],
      permission:  'data.ticket.sell.agency',
      sideEffects: [],
    },
    {
      id:          'e2',
      source:      'CONFIRMED',
      target:      'DONE',
      label:       'validate',
      guards:      [],
      permission:  'data.ticket.sell.agency',
      sideEffects: [],
    },
  ],
};

// ─── Mock factory ─────────────────────────────────────────────────────────────

type TransactFn = (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;

function makePrisma(opts: {
  workflowConfigs?:    object[];
  blueprint?:          object | null;
  blueprints?:         object[];
  rolePermissions?:    object[];
  slugConflict?:       boolean;
  blueprintInstall?:   object | null;
} = {}): jest.Mocked<PrismaService> {
  const configs         = opts.workflowConfigs  ?? [];
  const blueprint       = 'blueprint' in opts ? opts.blueprint : { id: BLUEPRINT_ID, graphJson: MINIMAL_GRAPH_DTO as any, isSystem: false, authorTenantId: TENANT_ID };
  const blueprints      = opts.blueprints       ?? [];
  const rolePermissions = opts.rolePermissions  ?? [];
  const slugConflict    = opts.slugConflict      ?? false;

  const transact: TransactFn = async (fn) => {
    const tx = {
      workflowConfig: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create:     jest.fn().mockResolvedValue({}),
        findMany:   jest.fn().mockResolvedValue(configs),
      },
      workflowBlueprint: {
        update: jest.fn().mockResolvedValue({}),
      },
      blueprintInstall: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(opts.blueprintInstall ?? null),
      },
    };
    return fn(tx);
  };

  return {
    workflowConfig: {
      findMany:   jest.fn().mockResolvedValue(configs),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create:     jest.fn().mockResolvedValue({}),
    },
    workflowBlueprint: {
      findFirst:  jest.fn().mockResolvedValue(blueprint),
      findMany:   jest.fn().mockResolvedValue(blueprints),
      create:     jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'bp-new', ...data })),
      update:     jest.fn().mockResolvedValue({}),
      delete:     jest.fn().mockResolvedValue({}),
    },
    blueprintInstall: {
      upsert:    jest.fn().mockResolvedValue({}),
      update:    jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(opts.blueprintInstall ?? null),
    },
    rolePermission: {
      findMany: jest.fn().mockResolvedValue(rolePermissions),
    },
    transact,
  } as unknown as jest.Mocked<PrismaService>;
}

// Configs Prisma pour le graphe minimal
const MINIMAL_PRISMA_CONFIGS = [
  {
    id: 'cfg-1', tenantId: TENANT_ID, entityType: 'Ticket',
    fromState: 'DRAFT', toState: 'CONFIRMED', action: 'confirm',
    guards: [], requiredPermission: 'data.ticket.sell.agency',
    sideEffects: [], isActive: true, position: null,
  },
  {
    id: 'cfg-2', tenantId: TENANT_ID, entityType: 'Ticket',
    fromState: 'CONFIRMED', toState: 'DONE', action: 'validate',
    guards: [], requiredPermission: 'data.ticket.sell.agency',
    sideEffects: [], isActive: true, position: null,
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowStudioService', () => {
  let svc: WorkflowStudioService;
  let prisma: jest.Mocked<PrismaService>;

  // ── simulateWorkflow ─────────────────────────────────────────────────────────

  describe('simulateWorkflow()', () => {
    beforeEach(() => {
      prisma = makePrisma({ workflowConfigs: MINIMAL_PRISMA_CONFIGS });
      svc    = new WorkflowStudioService(prisma);
    });

    it('retourne le chemin complet quand toutes les transitions réussissent', async () => {
      const result = await svc.simulateWorkflow(TENANT_ID, {
        entityType:   'Ticket',
        initialState: 'DRAFT',
        actions:      ['confirm', 'validate'],
      });

      expect(result.finalState).toBe('DONE');
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].reachable).toBe(true);
      expect(result.steps[1].reachable).toBe(true);
      expect(result.reachedStates).toContain('DONE');
    });

    it('stoppe au premier blocage de permission', async () => {
      prisma = makePrisma({ workflowConfigs: MINIMAL_PRISMA_CONFIGS });
      svc    = new WorkflowStudioService(prisma);

      // Rôle sans la permission requise
      (prisma.rolePermission.findMany as jest.Mock).mockResolvedValue([]);

      const result = await svc.simulateWorkflow(TENANT_ID, {
        entityType:    'Ticket',
        initialState:  'DRAFT',
        actions:       ['confirm', 'validate'],
        simulatedRoleId: 'role-without-perms',
      });

      expect(result.steps[0].permGranted).toBe(false);
      expect(result.steps[0].reachable).toBe(false);
      expect(result.steps).toHaveLength(1); // stoppe après le premier blocage
    });

    it("retourne reachable=false pour une transition qui n'existe pas dans l'état courant", async () => {
      const result = await svc.simulateWorkflow(TENANT_ID, {
        entityType:   'Ticket',
        initialState: 'DRAFT',
        actions:      ['inexistant_action'],
      });

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].reachable).toBe(false);
      expect(result.finalState).toBe('DRAFT'); // pas avancé
    });

    it('simule depuis un blueprint (blueprintId fourni)', async () => {
      const bpGraph = { ...MINIMAL_GRAPH_DTO, entityType: 'Ticket' };
      prisma = makePrisma({
        workflowConfigs: [],
        blueprint: {
          id: BLUEPRINT_ID,
          graphJson: bpGraph,
          isSystem: false,
          authorTenantId: TENANT_ID,
        },
      });
      svc = new WorkflowStudioService(prisma);

      const result = await svc.simulateWorkflow(TENANT_ID, {
        entityType:   'Ticket',
        initialState: 'DRAFT',
        actions:      ['confirm'],
        blueprintId:  BLUEPRINT_ID,
      });

      expect(result.steps[0].reachable).toBe(true);
      expect(result.finalState).toBe('CONFIRMED');
    });

    it("lance NotFoundException si blueprintId fourni mais blueprint introuvable", async () => {
      prisma = makePrisma({ blueprint: null });
      svc    = new WorkflowStudioService(prisma);

      await expect(
        svc.simulateWorkflow(TENANT_ID, {
          entityType:   'Ticket',
          initialState: 'DRAFT',
          actions:      [],
          blueprintId:  'bp-inexistant',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── createBlueprint ──────────────────────────────────────────────────────────

  describe('createBlueprint()', () => {
    beforeEach(() => {
      prisma = makePrisma({ slugConflict: false });
      svc    = new WorkflowStudioService(prisma);
    });

    it('crée un blueprint valide', async () => {
      // Mock findFirst slug check → null (pas de conflit)
      (prisma.workflowBlueprint.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await svc.createBlueprint(TENANT_ID, {
        name:       'Blueprint Ticket standard',
        slug:       'ticket-standard',
        entityType: 'Ticket',
        graph:      MINIMAL_GRAPH_DTO,
        isPublic:   false,
      }, ACTOR_ID);

      expect(result.name).toBe('Blueprint Ticket standard');
    });

    it('lance BadRequestException si slug déjà existant pour ce tenant', async () => {
      (prisma.workflowBlueprint.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });

      await expect(
        svc.createBlueprint(TENANT_ID, {
          name:       'Doublon',
          slug:       'ticket-standard',
          entityType: 'Ticket',
          graph:      MINIMAL_GRAPH_DTO,
        }, ACTOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lance BadRequestException si le graphe est invalide (graphe vide)', async () => {
      (prisma.workflowBlueprint.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        svc.createBlueprint(TENANT_ID, {
          name:       'Graphe vide',
          slug:       'graphe-vide',
          entityType: 'Ticket',
          graph:      { entityType: 'Ticket', nodes: [], edges: [] },
        }, ACTOR_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── getBlueprint ─────────────────────────────────────────────────────────────

  describe('getBlueprint()', () => {
    it('lance NotFoundException si le blueprint est introuvable', async () => {
      prisma = makePrisma({ blueprint: null });
      svc    = new WorkflowStudioService(prisma);

      await expect(
        svc.getBlueprint('bp-inexistant', TENANT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('retourne le blueprint si accessible', async () => {
      const bp = { id: BLUEPRINT_ID, name: 'Mon Blueprint', isSystem: false };
      prisma = makePrisma({ blueprint: bp });
      svc    = new WorkflowStudioService(prisma);

      const result = await svc.getBlueprint(BLUEPRINT_ID, TENANT_ID);
      expect(result.name).toBe('Mon Blueprint');
    });
  });

  // ── deleteBlueprint ──────────────────────────────────────────────────────────

  describe('deleteBlueprint()', () => {
    it("lance ForbiddenException quand on tente de supprimer un blueprint système", async () => {
      prisma = makePrisma({
        blueprint: {
          id: BLUEPRINT_ID,
          isSystem:        true,
          authorTenantId:  TENANT_ID,
        },
      });
      svc = new WorkflowStudioService(prisma);

      await expect(
        svc.deleteBlueprint(BLUEPRINT_ID, TENANT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('supprime un blueprint non-système possédé par le tenant', async () => {
      prisma = makePrisma({
        blueprint: {
          id: BLUEPRINT_ID,
          isSystem:        false,
          authorTenantId:  TENANT_ID,
        },
      });
      svc = new WorkflowStudioService(prisma);

      await expect(svc.deleteBlueprint(BLUEPRINT_ID, TENANT_ID)).resolves.not.toThrow();
      expect(prisma.workflowBlueprint.delete).toHaveBeenCalledWith({
        where: { id: BLUEPRINT_ID },
      });
    });
  });

  // ── listEntityTypes ──────────────────────────────────────────────────────────

  describe('listEntityTypes()', () => {
    it("retourne les entityTypes distincts du tenant", async () => {
      prisma = makePrisma({ workflowConfigs: MINIMAL_PRISMA_CONFIGS });
      svc    = new WorkflowStudioService(prisma);

      // Override findMany avec distinct simulé
      (prisma.workflowConfig.findMany as jest.Mock).mockResolvedValue([
        { entityType: 'Ticket' },
        { entityType: 'Trip' },
      ]);

      const types = await svc.listEntityTypes(TENANT_ID);
      expect(types).toContain('Ticket');
      expect(types).toContain('Trip');
    });
  });
});
