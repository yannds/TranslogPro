/**
 * SimulationWorkflowIO — Tests unitaires
 *
 * Vérifie que l'IO mémoire :
 *   - résout les configs depuis le graphe fourni (pas de DB)
 *   - capture les side-effects sans les exécuter
 *   - gère idempotence et version en mémoire comme le live
 *   - délègue les permissions à la vraie DB (fidélité)
 */
import { SimulationWorkflowIO } from '../io/simulation-workflow.io';
import { EntityFactoryRegistry } from '../io/entity-factory.registry';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { WorkflowGraph } from '../types/graph.types';
import { SideEffectDefinition } from '../types/side-effect-definition.type';
import { TransitionInput } from '../interfaces/transition-input.interface';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const GRAPH: WorkflowGraph = {
  entityType: 'Ticket',
  version:    '1.0.0',
  checksum:   '',
  metadata:   {},
  nodes: [
    { id: 'DRAFT',     label: 'Brouillon',  type: 'initial',  position: { x: 0, y: 0 }, metadata: {} },
    { id: 'CONFIRMED', label: 'Confirmé',   type: 'state',    position: { x: 0, y: 0 }, metadata: {} },
    { id: 'CANCELLED', label: 'Annulé',     type: 'terminal', position: { x: 0, y: 0 }, metadata: {} },
  ],
  edges: [
    {
      id:          'DRAFT___confirm___CONFIRMED',
      source:      'DRAFT',
      target:      'CONFIRMED',
      label:       'confirm',
      permission:  'data.ticket.create.agency',
      guards:      [],
      sideEffects: ['notifyPassenger'],
      metadata:    {},
    },
    {
      id:          'DRAFT___cancel___CANCELLED',
      source:      'DRAFT',
      target:      'CANCELLED',
      label:       'cancel',
      permission:  '', // pas de permission requise
      guards:      [],
      sideEffects: [],
      metadata:    {},
    },
  ],
};

function makePrismaMock(hasPermission: boolean = true) {
  return {
    rolePermission: {
      findFirst: jest.fn().mockResolvedValue(hasPermission ? { id: 'rp-1' } : null),
    },
  } as unknown as PrismaService;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SimulationWorkflowIO', () => {

  describe('supportsAggregateType', () => {
    it('accepte le type du graphe', () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      expect(io.supportsAggregateType('Ticket')).toBe(true);
    });

    it('refuse un type différent', () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      expect(io.supportsAggregateType('Trip')).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('résout une arête existante du graphe', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const cfg = await io.loadConfig('t', 'Ticket', 'DRAFT', 'confirm');
      expect(cfg).toEqual({ toState: 'CONFIRMED', requiredPerm: 'data.ticket.create.agency' });
    });

    it('retourne null pour une action inconnue', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const cfg = await io.loadConfig('t', 'Ticket', 'DRAFT', 'unknown');
      expect(cfg).toBeNull();
    });

    it('retourne null si le type ne matche pas le graphe', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const cfg = await io.loadConfig('t', 'Parcel', 'DRAFT', 'confirm');
      expect(cfg).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('lit la vraie table rolePermission en DB (fidélité)', async () => {
      const prisma = makePrismaMock(true);
      const io = new SimulationWorkflowIO(prisma, GRAPH);
      const granted = await io.hasPermission('role-1', 'data.ticket.create.agency');
      expect(granted).toBe(true);
      expect(prisma.rolePermission.findFirst).toHaveBeenCalledWith({
        where: { roleId: 'role-1', permission: 'data.ticket.create.agency' },
      });
    });

    it('refuse si le rôle n\'a pas la permission en DB', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(false), GRAPH);
      const granted = await io.hasPermission('role-1', 'data.ticket.create.agency');
      expect(granted).toBe(false);
    });

    it('autorise automatiquement si la permission est vide (transition libre)', async () => {
      const prisma = makePrismaMock();
      const io = new SimulationWorkflowIO(prisma, GRAPH);
      const granted = await io.hasPermission('role-1', '');
      expect(granted).toBe(true);
      expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('runInTransaction — opérations mémoire', () => {
    const INPUT: TransitionInput = {
      action: 'confirm',
      actor:  { id: 'u', tenantId: 't', roleId: 'r', roleName: 'X' },
    };

    it('capture les side-effects sans les exécuter', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const entity = EntityFactoryRegistry.create({ entityType: 'Ticket', tenantId: 't', initialState: 'DRAFT' });
      io.setEntity(entity);

      const seFn = jest.fn();
      const se: SideEffectDefinition<typeof entity> = { name: 'notifyPassenger', fn: seFn };

      await io.runInTransaction(async txIO => {
        await txIO.runSideEffect(se, entity, INPUT, {});
      });

      expect(seFn).not.toHaveBeenCalled(); // la fonction réelle N'est PAS invoquée
      expect(io.sideEffects).toHaveLength(1);
      expect(io.sideEffects[0]!.name).toBe('notifyPassenger');
    });

    it('persist() ne touche pas à Prisma, mute seulement l\'entité mémoire', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const entity = EntityFactoryRegistry.create({ entityType: 'Ticket', tenantId: 't', initialState: 'DRAFT' });
      io.setEntity(entity);

      const persistSpy = jest.fn(); // ne doit jamais être appelé

      const updated = await io.runInTransaction(async txIO => {
        return txIO.persist(entity, 'CONFIRMED', persistSpy);
      });

      expect(persistSpy).not.toHaveBeenCalled();
      expect(updated.status).toBe('CONFIRMED');
      expect(updated.version).toBe(entity.version + 1);
      expect(io.currentEntity?.id).toBe(updated.id);
    });

    it('lockEntity retourne la version de l\'entité sandbox', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const entity = EntityFactoryRegistry.create({ entityType: 'Ticket', tenantId: 't', initialState: 'DRAFT' });
      io.setEntity(entity);

      const result = await io.runInTransaction(async txIO => {
        return txIO.lockEntity('Ticket', entity.id);
      });

      expect(result).toEqual({ version: entity.version });
    });

    it('idempotence en mémoire détecte les replays', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      const entity = EntityFactoryRegistry.create({ entityType: 'Ticket', tenantId: 't', initialState: 'DRAFT' });
      io.setEntity(entity);

      await io.runInTransaction(async txIO => {
        await txIO.recordTransition({
          tenantId: 't', entityType: 'Ticket', entityId: entity.id,
          fromState: 'DRAFT', toState: 'CONFIRMED', action: 'confirm',
          userId: 'u', idempotencyKey: 'key-1',
        });
      });

      const replay = await io.findIdempotentTransition('key-1');
      expect(replay).toEqual({ toState: 'CONFIRMED', fromState: 'DRAFT' });
    });

    it('audit capturé sans écriture DB', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);

      await io.runInTransaction(async txIO => {
        await txIO.recordAudit({
          tenantId: 't', action: 'data.ticket.create.agency',
          resource: 'Ticket:abc',
        });
      });

      expect(io.auditEntries).toHaveLength(1);
      expect(io.auditEntries[0]!.action).toBe('data.ticket.create.agency');
      expect(io.auditEntries[0]!.capturedAt).toBeDefined();
    });
  });

  describe('getCapture', () => {
    it('retourne un snapshot immutable des buffers', async () => {
      const io = new SimulationWorkflowIO(makePrismaMock(), GRAPH);
      await io.runInTransaction(async txIO => {
        await txIO.recordAudit({ tenantId: 't', action: 'x', resource: 'y' });
      });

      const capture = io.getCapture();
      expect(capture.auditEntries).toHaveLength(1);

      // Muter le snapshot ne doit pas affecter l'IO
      capture.auditEntries.pop();
      expect(io.auditEntries).toHaveLength(1);
    });
  });
});

// ─── EntityFactoryRegistry ───────────────────────────────────────────────────

describe('EntityFactoryRegistry', () => {
  it('produit une entité sandbox pour chaque entityType supporté', () => {
    for (const type of EntityFactoryRegistry.supportedTypes()) {
      const ent = EntityFactoryRegistry.create({
        entityType:   type,
        tenantId:     'tenant-1',
        initialState: 'DRAFT',
      });
      expect(ent.id).toMatch(/^sandbox-/);
      expect(ent.tenantId).toBe('tenant-1');
      expect(ent.status).toBe('DRAFT');
      expect(ent.version).toBe(1);
    }
  });

  it('applique les overrides champ par champ', () => {
    const ent = EntityFactoryRegistry.create({
      entityType:   'Ticket',
      tenantId:     't',
      initialState: 'DRAFT',
      overrides:    { scanned: true, amount: 999 },
    });
    expect(ent.scanned).toBe(true);
    expect(ent.amount).toBe(999);
    expect(ent.paymentConfirmed).toBe(true); // défaut préservé
  });

  it('lève une erreur pour un entityType inconnu', () => {
    expect(() =>
      EntityFactoryRegistry.create({
        entityType: 'Dragon',
        tenantId:   't',
        initialState: 'INIT',
      }),
    ).toThrow(/Aucune factory sandbox/);
  });

  it('supporte les 10 entityTypes du PRD', () => {
    const types = EntityFactoryRegistry.supportedTypes();
    expect(types).toEqual(
      expect.arrayContaining([
        'Ticket', 'Trip', 'Parcel', 'Bus', 'Maintenance',
        'Manifest', 'Crew', 'Claim', 'Checklist', 'Driver',
      ]),
    );
  });
});
