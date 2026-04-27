/**
 * StaffProvisioningService — Tests unitaires.
 *
 * Couvre les invariants RBAC sync (docs/STAFF_RBAC_SYNC.md) :
 *   1. ensureStaffForUser idempotent (création + reconciliation)
 *   2. Refus userType !== 'STAFF'
 *   3. Refus roles externes (CUSTOMER, PUBLIC_REPORTER)
 *   4. Refus si Role(name) introuvable dans le tenant
 *   5. Sync User.roleId quand on fournit un role désaligné
 *   6. syncFromAssignment met à jour User.roleId si primary
 *   7. syncFromUserRole met à jour primary assignment.role
 *   8. No-op syncs sur cas limites (non-primary, no Staff, etc.)
 *
 * Mock : PrismaService uniquement.
 */

import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StaffProvisioningService } from '@modules/staff/staff-provisioning.service';
import { PrismaService } from '@infra/database/prisma.service';

const TENANT = 'tenant-001';
const USER   = 'user-001';
const STAFF  = 'staff-001';
const ASG    = 'asg-001';
const AGENCY = 'ag-001';

type PrismaMock = jest.Mocked<PrismaService>;

function makePrisma(over: Partial<{
  userFindFirst:        jest.Mock;
  userUpdate:           jest.Mock;
  roleFindFirst:        jest.Mock;
  staffCreate:          jest.Mock;
  assignmentCreate:     jest.Mock;
  assignmentFindFirst:  jest.Mock;
  assignmentUpdate:     jest.Mock;
}> = {}): PrismaMock {
  return {
    user: {
      findFirst: over.userFindFirst ?? jest.fn(),
      update:    over.userUpdate    ?? jest.fn().mockResolvedValue({}),
    },
    role: {
      findFirst: over.roleFindFirst ?? jest.fn().mockResolvedValue({ id: 'role-driver', name: 'DRIVER' }),
    },
    staff: {
      create:    over.staffCreate ?? jest.fn().mockResolvedValue({ id: STAFF }),
    },
    staffAssignment: {
      create:    over.assignmentCreate    ?? jest.fn().mockResolvedValue({ id: ASG }),
      findFirst: over.assignmentFindFirst ?? jest.fn().mockResolvedValue(null),
      update:    over.assignmentUpdate    ?? jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaMock;
}

function build(prisma?: PrismaMock) {
  const p = prisma ?? makePrisma();
  return { service: new StaffProvisioningService(p), prisma: p };
}

// ─── ensureStaffForUser ───────────────────────────────────────────────────────

describe('StaffProvisioningService.ensureStaffForUser', () => {
  it('rejette un User introuvable', async () => {
    const prisma = makePrisma({ userFindFirst: jest.fn().mockResolvedValue(null) });
    const { service } = build(prisma);
    await expect(
      service.ensureStaffForUser({ userId: USER, tenantId: TENANT, role: 'DRIVER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejette un User non-STAFF (CUSTOMER)', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'CUSTOMER', role: null, staffProfile: null,
      }),
    });
    const { service } = build(prisma);
    await expect(
      service.ensureStaffForUser({ userId: USER, tenantId: TENANT, role: 'DRIVER' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un rôle externe (CUSTOMER) même sur User STAFF', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF', role: null, staffProfile: null,
      }),
    });
    const { service } = build(prisma);
    await expect(
      service.ensureStaffForUser({ userId: USER, tenantId: TENANT, role: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette si aucun rôle cible (User sans role + role non fourni)', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF', role: null, staffProfile: null,
      }),
    });
    const { service } = build(prisma);
    await expect(
      service.ensureStaffForUser({ userId: USER, tenantId: TENANT }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejette si le Role n'existe pas dans le tenant", async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF', role: null, staffProfile: null, agencyId: null,
      }),
      roleFindFirst: jest.fn().mockResolvedValue(null),
    });
    const { service } = build(prisma);
    await expect(
      service.ensureStaffForUser({ userId: USER, tenantId: TENANT, role: 'NEW_CUSTOM_ROLE' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('crée Staff + assignment + sync roleId si User STAFF sans Staff', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF',
        roleId: 'role-old', role: { id: 'role-old', name: 'CASHIER' },
        staffProfile: null, agencyId: AGENCY,
      }),
    });
    const { service, prisma: p } = build(prisma);

    const result = await service.ensureStaffForUser({
      userId: USER, tenantId: TENANT, role: 'DRIVER', agencyId: AGENCY,
    });

    expect(result.created).toBe(true);
    expect(result.role).toBe('DRIVER');
    // User.roleId réaligné sur DRIVER
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: USER }, data: { roleId: 'role-driver' },
    });
    // Staff créé
    expect(p.staff.create).toHaveBeenCalled();
    // Assignment créé en ACTIVE
    expect(p.staffAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        staffId: STAFF, role: 'DRIVER', agencyId: AGENCY, status: 'ACTIVE',
      }),
    });
  });

  it("idempotent : si Staff + primary identique, ne refait pas l'assignment", async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF',
        roleId: 'role-driver', role: { id: 'role-driver', name: 'DRIVER' },
        staffProfile: { id: STAFF }, agencyId: AGENCY,
      }),
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: ASG, role: 'DRIVER', agencyId: AGENCY, status: 'ACTIVE',
      }),
    });
    const { service, prisma: p } = build(prisma);

    const result = await service.ensureStaffForUser({
      userId: USER, tenantId: TENANT, role: 'DRIVER', agencyId: AGENCY,
    });

    expect(result.created).toBe(false);
    expect(result.assignmentId).toBe(ASG);
    expect(p.staff.create).not.toHaveBeenCalled();
    expect(p.staffAssignment.create).not.toHaveBeenCalled();
    expect(p.staffAssignment.update).not.toHaveBeenCalled();
    // User.roleId déjà aligné → pas d'update
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it('réconcilie : Staff existe avec primary désaligné → update assignment.role', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF',
        roleId: 'role-cashier', role: { id: 'role-cashier', name: 'CASHIER' },
        staffProfile: { id: STAFF }, agencyId: AGENCY,
      }),
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: ASG, role: 'CASHIER', agencyId: AGENCY, status: 'ACTIVE',
      }),
    });
    const { service, prisma: p } = build(prisma);

    await service.ensureStaffForUser({
      userId: USER, tenantId: TENANT, role: 'DRIVER', agencyId: AGENCY,
    });

    expect(p.staffAssignment.update).toHaveBeenCalledWith({
      where: { id: ASG },
      data:  { role: 'DRIVER', agencyId: AGENCY },
    });
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: USER }, data: { roleId: 'role-driver' },
    });
  });

  it("Staff sans primary actif → crée un assignment", async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF',
        roleId: 'role-driver', role: { id: 'role-driver', name: 'DRIVER' },
        staffProfile: { id: STAFF }, agencyId: null,
      }),
      assignmentFindFirst: jest.fn().mockResolvedValue(null),
    });
    const { service, prisma: p } = build(prisma);

    const result = await service.ensureStaffForUser({
      userId: USER, tenantId: TENANT, role: 'DRIVER',
    });

    expect(result.created).toBe(false); // Staff pré-existant
    expect(p.staffAssignment.create).toHaveBeenCalled();
  });

  it('déduit le rôle du User.role.name si role non fourni', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, tenantId: TENANT, userType: 'STAFF',
        roleId: 'role-driver', role: { id: 'role-driver', name: 'DRIVER' },
        staffProfile: null, agencyId: AGENCY,
      }),
    });
    const { service } = build(prisma);
    const result = await service.ensureStaffForUser({ userId: USER, tenantId: TENANT });
    expect(result.role).toBe('DRIVER');
  });
});

// ─── syncFromAssignment ───────────────────────────────────────────────────────

describe('StaffProvisioningService.syncFromAssignment', () => {
  it('met à jour User.roleId si assignment est primary et Role existe', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn()
        .mockResolvedValueOnce({  // 1er call : findFirst pour récupérer l'asg
          id: ASG, role: 'MECHANIC', status: 'ACTIVE',
          staff: { id: STAFF, userId: USER, tenantId: TENANT },
        })
        .mockResolvedValueOnce({  // 2e call : getPrimaryAssignment
          id: ASG, role: 'MECHANIC', status: 'ACTIVE',
        }),
      roleFindFirst: jest.fn().mockResolvedValue({ id: 'role-mechanic' }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromAssignment(ASG);
    expect(p.user.update).toHaveBeenCalledWith({
      where: { id: USER }, data: { roleId: 'role-mechanic' },
    });
  });

  it("no-op si l'assignment n'est pas le primary", async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn()
        .mockResolvedValueOnce({  // l'asg cible
          id: ASG, role: 'MECHANIC', status: 'ACTIVE',
          staff: { id: STAFF, userId: USER, tenantId: TENANT },
        })
        .mockResolvedValueOnce({  // primary = autre asg
          id: 'asg-other', role: 'DRIVER', status: 'ACTIVE',
        }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromAssignment(ASG);
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it('no-op si assignment introuvable', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn().mockResolvedValue(null),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromAssignment(ASG);
    expect(p.user.update).not.toHaveBeenCalled();
  });

  it('warn et no-op si Role tenant introuvable', async () => {
    const prisma = makePrisma({
      assignmentFindFirst: jest.fn()
        .mockResolvedValueOnce({
          id: ASG, role: 'CUSTOM_X', status: 'ACTIVE',
          staff: { id: STAFF, userId: USER, tenantId: TENANT },
        })
        .mockResolvedValueOnce({ id: ASG, role: 'CUSTOM_X', status: 'ACTIVE' }),
      roleFindFirst: jest.fn().mockResolvedValue(null),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromAssignment(ASG);
    expect(p.user.update).not.toHaveBeenCalled();
  });
});

// ─── syncFromUserRole ─────────────────────────────────────────────────────────

describe('StaffProvisioningService.syncFromUserRole', () => {
  it('met à jour primary assignment.role si désaligné', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, userType: 'STAFF',
        role: { name: 'DRIVER' },
        staffProfile: { id: STAFF },
      }),
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: ASG, role: 'CASHIER', status: 'ACTIVE',
      }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromUserRole(USER);
    expect(p.staffAssignment.update).toHaveBeenCalledWith({
      where: { id: ASG },
      data:  { role: 'DRIVER' },
    });
  });

  it('no-op si User non-STAFF', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, userType: 'CUSTOMER',
        role: { name: 'CUSTOMER' },
        staffProfile: null,
      }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromUserRole(USER);
    expect(p.staffAssignment.update).not.toHaveBeenCalled();
  });

  it('no-op si User sans Staff', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, userType: 'STAFF',
        role: { name: 'DRIVER' },
        staffProfile: null,
      }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromUserRole(USER);
    expect(p.staffAssignment.update).not.toHaveBeenCalled();
  });

  it('no-op si role User externe (CUSTOMER)', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, userType: 'STAFF',
        role: { name: 'CUSTOMER' },
        staffProfile: { id: STAFF },
      }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromUserRole(USER);
    expect(p.staffAssignment.update).not.toHaveBeenCalled();
  });

  it('no-op si déjà aligné', async () => {
    const prisma = makePrisma({
      userFindFirst: jest.fn().mockResolvedValue({
        id: USER, userType: 'STAFF',
        role: { name: 'DRIVER' },
        staffProfile: { id: STAFF },
      }),
      assignmentFindFirst: jest.fn().mockResolvedValue({
        id: ASG, role: 'DRIVER', status: 'ACTIVE',
      }),
    });
    const { service, prisma: p } = build(prisma);
    await service.syncFromUserRole(USER);
    expect(p.staffAssignment.update).not.toHaveBeenCalled();
  });
});
