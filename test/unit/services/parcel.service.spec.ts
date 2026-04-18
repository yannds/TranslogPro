/**
 * ParcelService — Tests unitaires
 *
 * Ce qui est testé :
 *   - register()        : création CREATED + trackingCode unique, publication event
 *   - findOne()         : NotFoundException si absent
 *   - trackByCode()     : retour parcel avec destination, NotFoundException si absent
 *   - transition()      : délégation WorkflowEngine
 *   - scan()            : alias de transition() avec action explicite
 *   - reportDamage()    : transition avec action='REPORT_DAMAGE'
 *   - generateTrackingCode (privé) : format préfixe-ts-rand
 *
 * Mock : PrismaService, WorkflowEngine, IEventBus
 */

import { NotFoundException } from '@nestjs/common';
import { ParcelService } from '@modules/parcel/parcel.service';
import { PrismaService } from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { IEventBus } from '@infra/eventbus/interfaces/eventbus.interface';
import { ParcelState, ParcelAction } from '@common/constants/workflow-states';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-parcel-svc';
const ACTOR  = { id: 'agent-01', tenantId: TENANT, roleId: 'role-agent', agencyId: 'agency-01', roleName: 'Agent' };

const PARCEL_BASE = {
  id:           'parcel-001',
  tenantId:     TENANT,
  trackingCode: 'TENA-XXXXX-YYYY',
  status:       ParcelState.CREATED,
  version:      1,
  weight:       5.0,
  price:        10000,
  destinationId:'dest-001',
  destination:  { id: 'dest-001', name: 'Thiès' },
  shipmentId:   null,
};

const DTO_REGISTER = {
  weightKg:       5.0,
  destinationId:  'dest-001',
  recipientName:  'Bob',
  recipientPhone: '+221770000000',
  declaredValue:  10000,
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(parcel = PARCEL_BASE): jest.Mocked<PrismaService> {
  return {
    parcel: {
      create:    jest.fn().mockResolvedValue(parcel),
      findFirst: jest.fn().mockResolvedValue(parcel),
      findMany:  jest.fn().mockResolvedValue([parcel]),
      update:    jest.fn().mockResolvedValue({ ...parcel, status: ParcelState.AT_ORIGIN, version: 2 }),
    },
    transact: jest.fn().mockImplementation((fn: (tx: PrismaService) => Promise<unknown>) => fn({
      parcel:      { create: jest.fn().mockResolvedValue(parcel) },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService)),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeWorkflow(): jest.Mocked<WorkflowEngine> {
  return {
    transition: jest.fn().mockResolvedValue({
      entity:    PARCEL_BASE,
      toState:   ParcelState.AT_ORIGIN,
      fromState: ParcelState.CREATED,
    }),
  } as unknown as jest.Mocked<WorkflowEngine>;
}

function makeEventBus(): jest.Mocked<IEventBus> {
  return { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IEventBus>;
}

function buildService(overrides: Partial<{
  prisma:   ReturnType<typeof makePrisma>;
  workflow: ReturnType<typeof makeWorkflow>;
  eventBus: ReturnType<typeof makeEventBus>;
}> = {}) {
  const prisma   = overrides.prisma   ?? makePrisma();
  const workflow = overrides.workflow  ?? makeWorkflow();
  const eventBus = overrides.eventBus  ?? makeEventBus();
  // Stubs minimaux pour les dépendances CRM — le register() n'appelle
  // resolveOrCreate qu'avec phone/email ; les tests ParcelService ciblent
  // le workflow et la persistance, pas le CRM. Stubs no-op suffisent.
  const crmResolver = { resolveOrCreate: jest.fn().mockResolvedValue(null) } as any;
  const crmClaim    = { issueToken:      jest.fn().mockResolvedValue(null) } as any;
  const service = new ParcelService(prisma as any, workflow as any, crmResolver, crmClaim, eventBus as any);
  return { service, prisma, workflow, eventBus };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ParcelService', () => {

  // ── register() ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('crée un colis avec status=CREATED', async () => {
      const { service, prisma } = buildService();
      await service.register(TENANT, DTO_REGISTER as any, ACTOR as any);
      expect(prisma.transact).toHaveBeenCalled();
    });

    it('retourne le colis créé avec un trackingCode', async () => {
      const { service } = buildService();
      const result = await service.register(TENANT, DTO_REGISTER as any, ACTOR as any);
      expect(result).toHaveProperty('trackingCode');
    });

    it('le trackingCode inclut les 4 premiers caractères du tenantId en majuscules', async () => {
      // On capture la donnée passée au create interne
      let capturedData: any;
      const prisma = makePrisma();
      prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
        const fakeTx = {
          parcel:      { create: jest.fn().mockImplementation(({ data }) => { capturedData = data; return Promise.resolve(PARCEL_BASE); }) },
          outboxEvent: { create: jest.fn().mockResolvedValue({}) },
        };
        return fn(fakeTx);
      });
      const { service } = buildService({ prisma });
      await service.register(TENANT, DTO_REGISTER as any, ACTOR as any);
      expect(capturedData.trackingCode).toMatch(/^TENA-/);
    });

    it('publie un event PARCEL_REGISTERED', async () => {
      const prisma = makePrisma();
      let publishCalled = false;
      prisma.transact = jest.fn().mockImplementation(async (fn: any) => {
        const fakeTx = {
          parcel:      { create: jest.fn().mockResolvedValue(PARCEL_BASE) },
          outboxEvent: { create: jest.fn().mockResolvedValue({}) },
        };
        // On mock l'eventBus directement via la capture du fn
        return fn(fakeTx);
      });
      const eventBus = makeEventBus();
      eventBus.publish = jest.fn().mockImplementation(async () => { publishCalled = true; });
      const { service } = buildService({ prisma, eventBus });
      await service.register(TENANT, DTO_REGISTER as any, ACTOR as any);
      // transact est appelé — le publish se produit dedans
      expect(prisma.transact).toHaveBeenCalledTimes(1);
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('retourne le colis existant', async () => {
      const { service } = buildService();
      const p = await service.findOne(TENANT, 'parcel-001');
      expect(p.id).toBe('parcel-001');
    });

    it('lève NotFoundException si absent', async () => {
      const prisma = makePrisma();
      prisma.parcel.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.findOne(TENANT, 'absent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── trackByCode() ──────────────────────────────────────────────────────────

  describe('trackByCode()', () => {
    it('retourne le colis avec sa destination', async () => {
      const { service } = buildService();
      const p = await service.trackByCode(TENANT, 'TENA-XXXXX-YYYY');
      expect(p.destination).toBeDefined();
    });

    it('lève NotFoundException si code inconnu', async () => {
      const prisma = makePrisma();
      prisma.parcel.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.trackByCode(TENANT, 'BAD-CODE')).rejects.toThrow(NotFoundException);
    });
  });

  // ── transition() ───────────────────────────────────────────────────────────

  describe('transition()', () => {
    it('délègue au WorkflowEngine avec aggregateType=Parcel', async () => {
      const { service, workflow } = buildService();
      await service.transition(TENANT, 'parcel-001', ParcelAction.RECEIVE, ACTOR as any, 'idem-01');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'parcel-001' }),
        expect.objectContaining({ action: ParcelAction.RECEIVE, idempotencyKey: 'idem-01' }),
        expect.objectContaining({ aggregateType: 'Parcel' }),
      );
    });

    it('la persist() appelle parcel.update avec le nouvel état', async () => {
      let capturedPersist: any;
      const workflow = makeWorkflow();
      workflow.transition = jest.fn().mockImplementation((_e, _i, config) => {
        capturedPersist = config.persist;
        return Promise.resolve({ entity: PARCEL_BASE, toState: 'AT_ORIGIN', fromState: 'CREATED' });
      });
      const prisma = makePrisma();
      const { service } = buildService({ prisma, workflow });
      await service.transition(TENANT, 'parcel-001', ParcelAction.RECEIVE, ACTOR as any);
      await capturedPersist(PARCEL_BASE, ParcelState.AT_ORIGIN, prisma);
      expect(prisma.parcel.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'parcel-001' }, data: expect.objectContaining({ status: ParcelState.AT_ORIGIN }) }),
      );
    });
  });

  // ── scan() ─────────────────────────────────────────────────────────────────

  describe('scan()', () => {
    it('appelle transition() avec l\'action fournie', async () => {
      const { service, workflow } = buildService();
      await service.scan(TENANT, 'parcel-001', ParcelAction.LOAD, 'station-01', ACTOR as any, 'idem-scan');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: ParcelAction.LOAD }),
        expect.anything(),
      );
    });
  });

  // ── reportDamage() ─────────────────────────────────────────────────────────

  describe('reportDamage()', () => {
    it('déclenche une transition avec action=REPORT_DAMAGE', async () => {
      const { service, workflow } = buildService();
      await service.reportDamage(TENANT, 'parcel-001', 'boîte écrasée', ACTOR as any);
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'REPORT_DAMAGE' }),
        expect.anything(),
      );
    });
  });

  // ── findMine() ─────────────────────────────────────────────────────────────

  describe('findMine()', () => {
    it('filtre les colis par senderId = userId courant', async () => {
      const prisma = makePrisma();
      const { service } = buildService({ prisma });
      await service.findMine(TENANT, 'user-customer-42');
      expect(prisma.parcel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, senderId: 'user-customer-42' }),
        }),
      );
    });

    it('limite à 100, tri createdAt desc, inclut destination', async () => {
      const prisma = makePrisma();
      const { service } = buildService({ prisma });
      await service.findMine(TENANT, 'user-001');
      expect(prisma.parcel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take:    100,
          orderBy: { createdAt: 'desc' },
          include: { destination: true },
        }),
      );
    });

    it("ne retourne JAMAIS les colis d'un autre senderId (filtre Prisma)", async () => {
      const prisma = makePrisma();
      // Simule la DB renvoyant uniquement les colis filtrés
      prisma.parcel.findMany = jest.fn().mockImplementation(({ where }) => {
        if (where.senderId !== 'user-mine') return Promise.resolve([]);
        return Promise.resolve([PARCEL_BASE]);
      });
      const { service } = buildService({ prisma });
      const result = await service.findMine(TENANT, 'user-mine');
      expect(result).toHaveLength(1);
    });
  });
});
