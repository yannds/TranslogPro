/**
 * IncidentService — Tests unitaires (tenant isolation + scope own findMine).
 *
 * Ce qui est testé :
 *   - findMine() : filtre WHERE { tenantId, reportedById } — pas de leak cross-user
 *   - create() : passe tenantId + reportedById depuis actor
 *   - findOne() : NotFound si incident appartient à un autre tenant
 */

import { NotFoundException } from '@nestjs/common';
import { IncidentService } from '@modules/incident/incident.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-inc-001';
const OTHER = 'tenant-inc-OTHER';

const ACTOR = { id: 'user-1', tenantId: TENANT } as any;

function makePrisma(overrides: {
  findFirst?: jest.Mock;
  findMany?:  jest.Mock;
  create?:    jest.Mock;
  transact?:  jest.Mock;
} = {}): jest.Mocked<PrismaService> {
  return {
    incident: {
      findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
      findMany:  overrides.findMany  ?? jest.fn().mockResolvedValue([]),
      create:    overrides.create    ?? jest.fn().mockResolvedValue({ id: 'inc-1' }),
    },
    transact: overrides.transact ?? jest.fn().mockImplementation(async (fn: any) =>
      fn({
        incident: { create: jest.fn().mockResolvedValue({ id: 'inc-1' }) },
      }),
    ),
  } as unknown as jest.Mocked<PrismaService>;
}

function makeBus() {
  return { publish: jest.fn().mockResolvedValue(undefined) } as any;
}

function makeWorkflow() {
  // Les tests de ce fichier couvrent des méthodes (findMine/findOne/create) qui ne
  // font PAS de transition workflow. Un stub jest.fn() suffit.
  return { transition: jest.fn() } as any;
}

describe('IncidentService', () => {
  describe('findMine()', () => {
    it('filtre par tenantId + reportedById (scope own)', async () => {
      const prisma = makePrisma();
      const svc = new IncidentService(prisma, makeWorkflow(), makeBus());
      await svc.findMine(TENANT, ACTOR.id);
      const call = (prisma.incident.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ tenantId: TENANT, reportedById: ACTOR.id });
      // Liste stable + plafonnée
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
      expect(call.take).toBe(100);
    });

    it('ne retourne rien si aucun incident pour cet acteur', async () => {
      const prisma = makePrisma({ findMany: jest.fn().mockResolvedValue([]) });
      const svc = new IncidentService(prisma, makeWorkflow(), makeBus());
      const res = await svc.findMine(TENANT, ACTOR.id);
      expect(res).toEqual([]);
    });
  });

  describe('findOne() — TENANT ISOLATION', () => {
    it('lève NotFound si l\'incident appartient à un autre tenant', async () => {
      // Le where { id, tenantId: OTHER } ne trouvera pas un incident créé pour TENANT
      const prisma = makePrisma({ findFirst: jest.fn().mockResolvedValue(null) });
      const svc = new IncidentService(prisma, makeWorkflow(), makeBus());
      await expect(svc.findOne(OTHER, 'inc-1')).rejects.toThrow(NotFoundException);
      const call = (prisma.incident.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where).toEqual({ id: 'inc-1', tenantId: OTHER });
    });
  });

  describe('create()', () => {
    it('passe reportedById = actor.id + tenantId à la création', async () => {
      const inner = jest.fn().mockResolvedValue({ id: 'inc-2' });
      const prisma = makePrisma({
        transact: jest.fn().mockImplementation(async (fn: any) =>
          fn({ incident: { create: inner } }),
        ),
      });
      const svc = new IncidentService(prisma, makeWorkflow(), makeBus());
      await svc.create(TENANT, {
        type:        'PASSENGER' as any,
        severity:    'MEDIUM' as any,
        description: 'test',
      } as any, ACTOR);
      expect(inner).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, reportedById: ACTOR.id }),
      }));
    });
  });
});
