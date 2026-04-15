/**
 * StaffAssignmentService — Tests unitaires (Phase 3)
 *
 * Couvre les invariants du DESIGN_Staff_Assignment.md §4-§5 :
 *   - Combinaison interdite agencyId + coverageAgencyIds (§4.3)
 *   - Validation FK : agencyId hors tenant → 400
 *   - Doublon (staffId, role, agencyId) actif → 400 (§5.5)
 *   - Bascule mono ↔ multi purge les coverageAgencies
 *   - Update sur affectation CLOSED → 400
 *   - Close idempotent
 *   - addCoverageAgency rejeté si affectation mono
 *
 * Mock : PrismaService uniquement.
 */

import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StaffAssignmentService } from '@modules/staff/staff-assignment.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-001';
const STAFF  = { id: 'staff-001', tenantId: TENANT, userId: 'user-001' };
const AGENCY = { id: 'ag-001', tenantId: TENANT };

type PrismaMock = jest.Mocked<PrismaService>;

function makePrisma(over: Partial<{
  staffFindFirst:                   jest.Mock;
  agencyFindFirst:                  jest.Mock;
  assignmentFindFirst:              jest.Mock;
  assignmentCreate:                 jest.Mock;
  assignmentFindMany:               jest.Mock;
  assignmentUpdate:                 jest.Mock;
  coverageDeleteMany:               jest.Mock;
  coverageUpsert:                   jest.Mock;
  coverageDeleteManyForRemove:      jest.Mock;
}> = {}): PrismaMock {
  return {
    staff:  { findFirst: over.staffFindFirst  ?? jest.fn().mockResolvedValue(STAFF) },
    agency: { findFirst: over.agencyFindFirst ?? jest.fn().mockResolvedValue(AGENCY) },
    staffAssignment: {
      findFirst: over.assignmentFindFirst ?? jest.fn().mockResolvedValue(null),
      create:    over.assignmentCreate    ?? jest.fn().mockResolvedValue({ id: 'asg-001' }),
      findMany:  over.assignmentFindMany  ?? jest.fn().mockResolvedValue([]),
      update:    over.assignmentUpdate    ?? jest.fn().mockResolvedValue({ id: 'asg-001' }),
    },
    staffAssignmentAgency: {
      deleteMany: over.coverageDeleteMany ?? jest.fn().mockResolvedValue({ count: 1 }),
      upsert:     over.coverageUpsert     ?? jest.fn().mockResolvedValue({ assignmentId: 'asg-001', agencyId: AGENCY.id }),
    },
  } as unknown as PrismaMock;
}

function build(prisma?: PrismaMock) {
  const p = prisma ?? makePrisma();
  return { service: new StaffAssignmentService(p), prisma: p };
}

// ─── create ───────────────────────────────────────────────────────────────────
describe('StaffAssignmentService.create', () => {
  it('rejette agencyId + coverageAgencyIds simultanés (§4.3)', async () => {
    const { service } = build();
    await expect(
      service.create(TENANT, STAFF.userId, {
        role: 'CONTROLLER',
        agencyId: AGENCY.id,
        coverageAgencyIds: ['ag-002'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette une agence hors tenant (FK)', async () => {
    const prisma = makePrisma({ agencyFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(
      service.create(TENANT, STAFF.userId, { role: 'DRIVER', agencyId: 'ag-foreign' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette doublon (staffId, role, agencyId) ACTIVE (§5.5)', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({ id: 'existing-asg' }),
    });
    const { service } = build(prisma);
    await expect(
      service.create(TENANT, STAFF.userId, { role: 'DRIVER', agencyId: AGENCY.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('crée une affectation tenant-wide quand agencyId omis', async () => {
    const { service, prisma } = build();
    await service.create(TENANT, STAFF.userId, { role: 'CONTROLLER' });
    expect(prisma.staffAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ staffId: STAFF.id, role: 'CONTROLLER', agencyId: null }),
      }),
    );
  });

  it('crée une affectation multi-spécifique avec coverageAgencyIds', async () => {
    const { service, prisma } = build();
    await service.create(TENANT, STAFF.userId, {
      role: 'CONTROLLER',
      coverageAgencyIds: ['ag-001', 'ag-002'],
    });
    expect(prisma.staffAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coverageAgencies: { create: [{ agencyId: 'ag-001' }, { agencyId: 'ag-002' }] },
        }),
      }),
    );
  });

  it('NotFoundException si staff introuvable', async () => {
    const prisma = makePrisma({ staffFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(
      service.create(TENANT, 'unknown-user', { role: 'DRIVER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─── update ───────────────────────────────────────────────────────────────────
describe('StaffAssignmentService.update', () => {
  it('refuse de modifier une affectation CLOSED', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'CLOSED', coverageAgencies: [],
      }),
    });
    const { service } = build(prisma);
    await expect(
      service.update(TENANT, 'asg-001', { isAvailable: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('purge coverageAgencies quand on bascule en mono-agence', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'ACTIVE',
        coverageAgencies: [{ agencyId: 'ag-002' }, { agencyId: 'ag-003' }],
      }),
    });
    const { service } = build(prisma);
    await service.update(TENANT, 'asg-001', { agencyId: AGENCY.id });
    expect(prisma.staffAssignmentAgency.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: 'asg-001' },
    });
  });
});

// ─── close ────────────────────────────────────────────────────────────────────
describe('StaffAssignmentService.close', () => {
  it('idempotent si déjà CLOSED', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'CLOSED', coverageAgencies: [],
      }),
    });
    const { service } = build(prisma);
    await service.close(TENANT, 'asg-001');
    expect(prisma.staffAssignment.update).not.toHaveBeenCalled();
  });

  it('passe status=CLOSED + endDate + isAvailable=false', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'ACTIVE', coverageAgencies: [],
      }),
    });
    const { service } = build(prisma);
    await service.close(TENANT, 'asg-001');
    expect(prisma.staffAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asg-001' },
        data:  expect.objectContaining({ status: 'CLOSED', isAvailable: false }),
      }),
    );
  });
});

// ─── addCoverageAgency / removeCoverageAgency ─────────────────────────────────
describe('StaffAssignmentService.addCoverageAgency', () => {
  it('rejette si l\'affectation est mono-agence', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'ACTIVE', agencyId: AGENCY.id, coverageAgencies: [],
      }),
    });
    const { service } = build(prisma);
    await expect(
      service.addCoverageAgency(TENANT, 'asg-001', 'ag-002'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upsert idempotent pour ajout couverture', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'ACTIVE', agencyId: null, coverageAgencies: [],
      }),
    });
    const { service } = build(prisma);
    await service.addCoverageAgency(TENANT, 'asg-001', AGENCY.id);
    expect(prisma.staffAssignmentAgency.upsert).toHaveBeenCalled();
  });
});

describe('StaffAssignmentService.removeCoverageAgency', () => {
  it('NotFoundException si l\'agence n\'est pas couverte', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: 'asg-001', status: 'ACTIVE', agencyId: null, coverageAgencies: [],
      }),
      coverageDeleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    });
    const { service } = build(prisma);
    await expect(
      service.removeCoverageAgency(TENANT, 'asg-001', 'ag-foreign'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
