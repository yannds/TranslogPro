/**
 * AgencyService — Tests unitaires
 *
 * Ce qui est testé :
 *   - create()   : BadRequestException si nom vide, station hors tenant → 400
 *   - findAll()  : filtrage par tenantId
 *   - findOne()  : NotFoundException si absent
 *   - update()   : NotFoundException si absent, BadRequestException si nom vidé
 *   - remove()   : ConflictException si dernière agence (INVARIANT ≥1),
 *                  détache les users puis supprime sinon
 *
 * Mock : PrismaService uniquement.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AgencyService } from '@modules/agency/agency.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-agency-001';

const AGENCY = {
  id:        'ag-001',
  tenantId:  TENANT,
  name:      'Siège',
  stationId: null as string | null,
};

type PrismaMock = jest.Mocked<PrismaService>;

function makePrisma(overrides: {
  agencyFindFirst?:     jest.Mock;
  agencyFindMany?:      jest.Mock;
  agencyCreate?:        jest.Mock;
  agencyUpdate?:        jest.Mock;
  agencyDelete?:        jest.Mock;
  agencyCount?:         jest.Mock;
  stationFindFirst?:    jest.Mock;
  userUpdateMany?:      jest.Mock;
  cashRegisterCreate?:  jest.Mock;
  transact?:            jest.Mock;
} = {}): PrismaMock {
  const agencyCreateMock = overrides.agencyCreate ?? jest.fn().mockResolvedValue(AGENCY);
  const cashRegisterCreateMock =
    overrides.cashRegisterCreate ?? jest.fn().mockResolvedValue({ id: 'vreg-001', kind: 'VIRTUAL' });
  const tx = {
    user:         { updateMany: overrides.userUpdateMany ?? jest.fn().mockResolvedValue({ count: 0 }) },
    agency:       {
      create: agencyCreateMock,
      delete: overrides.agencyDelete   ?? jest.fn().mockResolvedValue(AGENCY),
    },
    cashRegister: {
      create:     cashRegisterCreateMock,
      // Nettoyage VIRTUAL register avant agency.delete (FK).
      findMany:   jest.fn().mockResolvedValue([]),  // aucune caisse VIRTUAL → no-op dans le service
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    transaction:  {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    agency: {
      findFirst: overrides.agencyFindFirst ?? jest.fn().mockResolvedValue(AGENCY),
      findMany:  overrides.agencyFindMany  ?? jest.fn().mockResolvedValue([AGENCY]),
      create:    agencyCreateMock,
      update:    overrides.agencyUpdate    ?? jest.fn().mockResolvedValue(AGENCY),
      count:     overrides.agencyCount     ?? jest.fn().mockResolvedValue(2),
    },
    station: {
      findFirst: overrides.stationFindFirst ?? jest.fn().mockResolvedValue({ id: 'st-001' }),
    },
    cashRegister: { create: cashRegisterCreateMock },
    transact: overrides.transact ?? jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaMock;
}

function build(prisma?: PrismaMock) {
  const p = prisma ?? makePrisma();
  return { service: new AgencyService(p), prisma: p };
}

// ─── create ───────────────────────────────────────────────────────────────────
describe('AgencyService.create', () => {
  it('rejette un nom vide (400)', async () => {
    const { service } = build();
    await expect(service.create(TENANT, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trim le nom, crée l\'agence ET provisionne la caisse virtuelle (atomique)', async () => {
    const { service, prisma } = build();
    await service.create(TENANT, { name: '  Paris  ' });
    expect(prisma.agency.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, name: 'Paris', stationId: null },
    });
    expect(prisma.cashRegister.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId:       TENANT,
        agencyId:       AGENCY.id,
        agentId:        'SYSTEM',
        kind:           'VIRTUAL',
        status:         'OPEN',
        initialBalance: 0,
      }),
    });
  });

  it('rejette une station hors tenant (400)', async () => {
    const prisma = makePrisma({ stationFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(
      service.create(TENANT, { name: 'Paris', stationId: 'st-foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─── findOne ──────────────────────────────────────────────────────────────────
describe('AgencyService.findOne', () => {
  it('NotFoundException si absente', async () => {
    const prisma = makePrisma({ agencyFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(service.findOne(TENANT, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retourne l\'agence si trouvée', async () => {
    const { service } = build();
    await expect(service.findOne(TENANT, AGENCY.id)).resolves.toMatchObject({ id: AGENCY.id });
  });
});

// ─── update ───────────────────────────────────────────────────────────────────
describe('AgencyService.update', () => {
  it('NotFoundException si agence absente', async () => {
    const prisma = makePrisma({ agencyFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(service.update(TENANT, 'missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('BadRequestException si nom vidé', async () => {
    const { service } = build();
    await expect(service.update(TENANT, AGENCY.id, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('met à jour uniquement les champs fournis', async () => {
    const { service, prisma } = build();
    await service.update(TENANT, AGENCY.id, { name: 'Lyon' });
    expect(prisma.agency.update).toHaveBeenCalledWith({
      where: { id: AGENCY.id },
      data:  { name: 'Lyon' },
    });
  });

  it('accepte stationId=null (détachement)', async () => {
    const { service, prisma } = build();
    await service.update(TENANT, AGENCY.id, { stationId: null });
    expect(prisma.agency.update).toHaveBeenCalledWith({
      where: { id: AGENCY.id },
      data:  { stationId: null },
    });
  });
});

// ─── remove (INVARIANT ≥1) ────────────────────────────────────────────────────
describe('AgencyService.remove — invariant ≥1 agence par tenant', () => {
  it('ConflictException si c\'est la dernière agence', async () => {
    const prisma = makePrisma({ agencyCount: jest.fn().mockResolvedValue(1) });
    const { service } = build(prisma);
    await expect(service.remove(TENANT, AGENCY.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ConflictException si count = 0 (garde défensive)', async () => {
    const prisma = makePrisma({ agencyCount: jest.fn().mockResolvedValue(0) });
    const { service } = build(prisma);
    await expect(service.remove(TENANT, AGENCY.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('détache les users orphelins puis supprime si count > 1', async () => {
    const userUpdateMany = jest.fn().mockResolvedValue({ count: 3 });
    const agencyDelete   = jest.fn().mockResolvedValue(AGENCY);
    const prisma = makePrisma({
      agencyCount: jest.fn().mockResolvedValue(3),
      userUpdateMany,
      agencyDelete,
    });
    const { service } = build(prisma);

    const res = await service.remove(TENANT, AGENCY.id);

    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, agencyId: AGENCY.id },
      data:  { agencyId: null },
    });
    expect(agencyDelete).toHaveBeenCalledWith({ where: { id: AGENCY.id } });
    expect(res).toEqual({ deleted: true });
  });

  it('NotFoundException si agence inexistante (avant count check)', async () => {
    const prisma = makePrisma({ agencyFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(service.remove(TENANT, 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─── findAll ──────────────────────────────────────────────────────────────────
describe('AgencyService.findAll', () => {
  it('filtre par tenantId et trie par nom', async () => {
    const { service, prisma } = build();
    await service.findAll(TENANT);
    expect(prisma.agency.findMany).toHaveBeenCalledWith({
      where:   { tenantId: TENANT },
      select:  { id: true, name: true, stationId: true },
      orderBy: { name: 'asc' },
    });
  });
});
