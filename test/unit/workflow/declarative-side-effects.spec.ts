/**
 * Test Sprint C : pipeline déclaratif bout-en-bout.
 *
 * Démontre qu'un blueprint WorkflowConfig peut déclarer des side-effects par
 * nom (`["logTransition", "handlerX"]`), que l'engine les résout via
 * SideEffectRegistry et les exécute dans la transaction.
 *
 * Utilise le même pattern que les tests graph existants (mocks Prisma +
 * WorkflowEngine) pour rester cohérent avec la base de tests.
 */
import { WorkflowEngine } from '../../../src/core/workflow/workflow.engine';
import { SideEffectRegistry } from '../../../src/core/workflow/side-effect.registry';
import { AuditService } from '../../../src/core/workflow/audit.service';
import { PrismaService } from '../../../src/infrastructure/database/prisma.service';

const TENANT = 'tenant-demo';
const ACTOR  = {
  id:       'user-01',
  tenantId: TENANT,
  roleId:   'role-01',
  roleName: 'ADMIN',
  agencyId: 'agency-01',
} as any;

function makeWfConfig(sideEffects: unknown) {
  return {
    id:            'wf-01',
    tenantId:      TENANT,
    entityType:    'Ticket',
    fromState:     'CREATED',
    action:        'CONFIRM',
    toState:       'CONFIRMED',
    requiredPerm:  'data.ticket.scan.agency',
    guards:        [],
    sideEffects,
    version:       1,
    isActive:      true,
    effectiveFrom: new Date(),
  };
}

function makePrisma(sideEffects: unknown): jest.Mocked<PrismaService> {
  return {
    workflowConfig: {
      findFirst: jest.fn().mockResolvedValue(makeWfConfig(sideEffects)),
    },
    rolePermission: {
      findFirst: jest.fn().mockResolvedValue({ id: 'rp-01', roleId: ACTOR.roleId, permission: 'data.ticket.scan.agency' }),
    },
    workflowTransition: {
      findUnique: jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({}),
    },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      workflowTransition: {
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ version: 1 }]),
    } as unknown as PrismaService)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeAudit(): jest.Mocked<AuditService> {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<AuditService>;
}

function makePersist() {
  return jest.fn().mockImplementation(async (entity: any, toState: string) => ({
    ...entity, status: toState, version: entity.version + 1,
  }));
}

describe('Workflow declarative side-effects (Sprint C)', () => {
  const baseEntity = { id: 'e1', tenantId: TENANT, status: 'CREATED', version: 1 } as any;
  const baseInput  = { action: 'CONFIRM', actor: ACTOR };

  it('ignore les noms inconnus sans échouer', async () => {
    const prisma   = makePrisma(['unknownHandler']);
    const registry = new SideEffectRegistry();
    const calledWith: string[] = [];
    registry.register('knownHandler', async () => { calledWith.push('known'); });

    const engine = new WorkflowEngine(prisma, makeAudit(), registry);
    await engine.transition(baseEntity, baseInput, { aggregateType: 'Ticket', persist: makePersist() });
    expect(calledWith).toEqual([]); // handler non listé dans le blueprint
  });

  it('résout + exécute les handlers listés dans le blueprint', async () => {
    const prisma   = makePrisma(['handlerA', 'handlerB']);
    const registry = new SideEffectRegistry();
    const handlerA = jest.fn().mockResolvedValue(undefined);
    const handlerB = jest.fn().mockResolvedValue(undefined);
    registry.register('handlerA', handlerA);
    registry.register('handlerB', handlerB);

    const engine = new WorkflowEngine(prisma, makeAudit(), registry);
    await engine.transition(baseEntity, baseInput, { aggregateType: 'Ticket', persist: makePersist() });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    // Handlers reçoivent l'entité POST-persist (status mis à jour)
    const [entityPassed] = handlerA.mock.calls[0];
    expect(entityPassed.status).toBe('CONFIRMED');
  });

  it('tolère le format {name, params} dans le blueprint JSON', async () => {
    const prisma   = makePrisma([
      { name: 'handlerX', params: { foo: 'bar' } },
      'handlerY',
    ]);
    const registry = new SideEffectRegistry();
    const handlerX = jest.fn();
    const handlerY = jest.fn();
    registry.register('handlerX', handlerX);
    registry.register('handlerY', handlerY);

    const engine = new WorkflowEngine(prisma, makeAudit(), registry);
    await engine.transition(baseEntity, baseInput, { aggregateType: 'Ticket', persist: makePersist() });

    expect(handlerX).toHaveBeenCalledTimes(1);
    expect(handlerY).toHaveBeenCalledTimes(1);
  });

  it('propage l\'exception d\'un handler → rollback de la transition', async () => {
    const prisma   = makePrisma(['breakingHandler']);
    const registry = new SideEffectRegistry();
    registry.register('breakingHandler', async () => {
      throw new Error('Intentional side-effect failure');
    });

    const engine = new WorkflowEngine(prisma, makeAudit(), registry);
    await expect(
      engine.transition(baseEntity, baseInput, { aggregateType: 'Ticket', persist: makePersist() }),
    ).rejects.toThrow('Intentional side-effect failure');
  });

  it('blueprint sans sideEffects (array vide) → aucun handler déclenché', async () => {
    const prisma   = makePrisma([]);
    const registry = new SideEffectRegistry();
    const handler  = jest.fn();
    registry.register('x', handler);

    const engine = new WorkflowEngine(prisma, makeAudit(), registry);
    await engine.transition(baseEntity, baseInput, { aggregateType: 'Ticket', persist: makePersist() });
    expect(handler).not.toHaveBeenCalled();
  });
});
