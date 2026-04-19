/**
 * TripService — Tests unitaires
 *
 * Ce qui est testé :
 *   - create()     : création avec status=PLANNED et les champs corrects
 *   - findAll()    : délégation prisma.trip.findMany avec filtres
 *   - findOne()    : NotFoundException si absent
 *   - transition() : délégation WorkflowEngine + publication event dans persist()
 *
 * Mock : PrismaService, WorkflowEngine, IEventBus
 */

import { NotFoundException } from '@nestjs/common';
import { TripService } from '@modules/trip/trip.service';
import { PrismaService } from '@infra/database/prisma.service';
import { WorkflowEngine } from '@core/workflow/workflow.engine';
import { IEventBus } from '@infra/eventbus/interfaces/eventbus.interface';
import { SchedulingGuardService } from '@modules/scheduling-guard/scheduling-guard.service';
import { TripState, TripAction } from '@common/constants/workflow-states';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-trip-001';
const ACTOR  = { id: 'driver-01', tenantId: TENANT, roleId: 'role-driver', agencyId: 'agency-01', roleName: 'Driver' };

const TRIP_BASE = {
  id:                  'trip-001',
  tenantId:            TENANT,
  routeId:             'route-001',
  busId:               'bus-001',
  driverId:            'driver-01',
  status:              TripState.PLANNED,
  version:             1,
  departureScheduled:  new Date('2026-05-01T08:00:00Z'),
  arrivalScheduled:    new Date('2026-05-01T14:00:00Z'),
  route:               { id: 'route-001', name: 'Dakar-Thiès' },
  bus:                 { id: 'bus-001', plate: 'DK-1234' },
  travelers:           [],
};

const DTO_CREATE = {
  routeId:              'route-001',
  busId:                'bus-001',
  driverId:             'driver-01',
  departureTime:        '2026-05-01T08:00:00Z',
  estimatedArrivalTime: '2026-05-01T14:00:00Z',
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(trip = TRIP_BASE): jest.Mocked<PrismaService> {
  // Le service fait plusieurs findFirst distincts :
  //   - overlap check (where contient { OR: [{ busId }, { driverId }] }) → doit rendre null
  //   - findOne (where: { id, tenantId }) → doit rendre le trip
  // Pour respecter les deux comportements, on inspecte le where.
  const findFirst = jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
    const hasOverlap = Array.isArray(args?.where?.OR);
    if (hasOverlap) return Promise.resolve(null);
    return Promise.resolve(trip);
  });
  return {
    trip: {
      create:    jest.fn().mockResolvedValue(trip),
      findMany:  jest.fn().mockResolvedValue([trip]),
      findFirst,
      update:    jest.fn().mockResolvedValue({ ...trip, status: TripState.BOARDING, version: 2 }),
    },
    // findOne() et findAll() hydrate les données RH du chauffeur → stub staff.
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id:     'driver-01',
        userId: 'user-drv-01',
        user:   { id: 'user-drv-01', name: 'Chauffeur Test', email: 'drv@example.com' },
      }),
      findMany: jest.fn().mockResolvedValue([{
        id:   'driver-01',
        user: { id: 'user-drv-01', name: 'Chauffeur Test', email: 'drv@example.com' },
      }]),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeWorkflow(): jest.Mocked<WorkflowEngine> {
  return {
    transition: jest.fn().mockResolvedValue({ entity: TRIP_BASE, toState: TripState.BOARDING, fromState: TripState.PLANNED }),
  } as unknown as jest.Mocked<WorkflowEngine>;
}

function makeEventBus(): jest.Mocked<IEventBus> {
  return { publish: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<IEventBus>;
}

// SchedulingGuardService — mock « assignable » par défaut pour ne pas bloquer create()
function makeSchedulingGuard(): jest.Mocked<SchedulingGuardService> {
  return {
    checkAssignability: jest.fn().mockResolvedValue({ canAssign: true, reasons: [] }),
  } as unknown as jest.Mocked<SchedulingGuardService>;
}

function buildService(overrides: Partial<{
  prisma:   ReturnType<typeof makePrisma>;
  workflow: ReturnType<typeof makeWorkflow>;
  eventBus: ReturnType<typeof makeEventBus>;
  guard:    ReturnType<typeof makeSchedulingGuard>;
}> = {}) {
  const prisma   = overrides.prisma   ?? makePrisma();
  const workflow = overrides.workflow  ?? makeWorkflow();
  const eventBus = overrides.eventBus  ?? makeEventBus();
  const guard    = overrides.guard    ?? makeSchedulingGuard();
  return {
    service: new TripService(prisma, workflow, guard, eventBus),
    prisma, workflow, eventBus, guard,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TripService', () => {

  // ── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('crée un trip avec status=PLANNED', async () => {
      const { service, prisma } = buildService();
      await service.create(TENANT, DTO_CREATE as any);
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT,
            status:   TripState.PLANNED,
            version:  0,
          }),
        }),
      );
    });

    it('convertit departureTime en Date', async () => {
      const { service, prisma } = buildService();
      await service.create(TENANT, DTO_CREATE as any);
      const call = (prisma.trip.create as jest.Mock).mock.calls[0][0];
      expect(call.data.departureScheduled).toBeInstanceOf(Date);
    });

    it('ajoute +1h par défaut pour arrivalScheduled si estimatedArrivalTime absent (chevauchement detection)', async () => {
      const { service, prisma } = buildService();
      const dto = { ...DTO_CREATE, estimatedArrivalTime: undefined };
      await service.create(TENANT, dto as any);
      const call = (prisma.trip.create as jest.Mock).mock.calls[0][0];
      const oneHourMs = 60 * 60 * 1_000;
      const delta = call.data.arrivalScheduled.getTime() - call.data.departureScheduled.getTime();
      expect(delta).toBe(oneHourMs);
    });
  });

  // ── findAll() ──────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('retourne la liste sans filtre', async () => {
      const { service } = buildService();
      const trips = await service.findAll(TENANT);
      expect(trips).toHaveLength(1);
    });

    it('filtre par status si fourni', async () => {
      const { service, prisma } = buildService();
      await service.findAll(TENANT, { status: TripState.PLANNED });
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: TripState.PLANNED }) }),
      );
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('retourne le trip existant', async () => {
      const { service } = buildService();
      const trip = await service.findOne(TENANT, 'trip-001');
      expect(trip.id).toBe('trip-001');
    });

    it('lève NotFoundException si absent', async () => {
      const prisma = makePrisma();
      prisma.trip.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.findOne(TENANT, 'absent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── transition() ───────────────────────────────────────────────────────────

  describe('transition()', () => {
    it('délègue au WorkflowEngine avec le bon aggregateType', async () => {
      const { service, workflow } = buildService();
      await service.transition(TENANT, 'trip-001', TripAction.START_BOARDING, ACTOR as any, 'idem-01');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'trip-001' }),
        expect.objectContaining({ action: TripAction.START_BOARDING }),
        expect.objectContaining({ aggregateType: 'Trip' }),
      );
    });

    it('passe l\'idempotencyKey au WorkflowEngine', async () => {
      const { service, workflow } = buildService();
      await service.transition(TENANT, 'trip-001', TripAction.DEPART, ACTOR as any, 'idem-key-xyz');
      expect(workflow.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ idempotencyKey: 'idem-key-xyz' }),
        expect.anything(),
      );
    });

    it('la fonction persist() appelle trip.update()', async () => {
      // On capture persist pour le tester directement
      const workflow = makeWorkflow();
      let capturedPersist: ((entity: any, state: string, prisma: any) => Promise<any>) | undefined;
      workflow.transition = jest.fn().mockImplementation((_entity, _input, config) => {
        capturedPersist = config.persist;
        return Promise.resolve({ entity: TRIP_BASE, toState: 'BOARDING', fromState: 'PLANNED' });
      });

      const prisma = makePrisma();
      const { service } = buildService({ prisma, workflow });
      await service.transition(TENANT, 'trip-001', TripAction.START_BOARDING, ACTOR as any);

      // Appeler persist directement pour vérifier qu'il appelle trip.update
      expect(capturedPersist).toBeDefined();
      await capturedPersist!(TRIP_BASE, TripState.BOARDING, prisma);
      expect(prisma.trip.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'trip-001' }, data: expect.objectContaining({ status: TripState.BOARDING }) }),
      );
    });

    it('lève NotFoundException si trip absent', async () => {
      const prisma = makePrisma();
      prisma.trip.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(
        service.transition(TENANT, 'absent', TripAction.DEPART, ACTOR as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
