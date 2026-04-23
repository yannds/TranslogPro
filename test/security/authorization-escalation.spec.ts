/**
 * Security Test — Authorization & Privilege Escalation
 *
 * Tests unitaires sur PermissionGuard.
 * Vérifie :
 *   - Route sans @RequirePermission → accès autorisé (open explicit)
 *   - Route @RequirePermission + user sans permission → Forbidden
 *   - Route @RequirePermission + user avec permission → OK
 *   - Platform tenant (00000000-...) + user sans sentinel permission → Forbidden
 *   - Scope agency → Forbidden si pas d'agencyId sur le user
 *   - Non-authentifié → Unauthorized
 */
import 'reflect-metadata';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PermissionGuard,
  PLATFORM_TENANT_ID,
  SCOPE_CONTEXT_KEY,
} from '@/core/iam/guards/permission.guard';
import { PERMISSION_KEY } from '@/common/decorators/require-permission.decorator';
import { PUBLIC_ROUTE_KEY } from '@/common/decorators/public-route.decorator';

/**
 * Helper : stub du reflector qui ne répond qu'au PERMISSION_KEY. Nécessaire
 * depuis que PermissionGuard check aussi PUBLIC_ROUTE_KEY en premier — un
 * mockReturnValue global retournerait la perm comme `publicReason`, faisant
 * bypass le guard.
 */
function stubPerm(reflector: Reflector, perm: string | string[] | undefined) {
  jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
    if (key === PERMISSION_KEY)   return perm as any;
    if (key === PUBLIC_ROUTE_KEY) return undefined as any;
    return undefined as any;
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(req: any, requiredPermissions?: string | string[]): ExecutionContext {
  const handler = {};
  const classRef = {};
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext:     () => undefined,
    }),
    getHandler: () => handler,
    getClass:   () => classRef,
  } as unknown as ExecutionContext;
}

function makeRedisMock() {
  return {
    get:   jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  } as any;
}

function makePrisma(hasPermissions: string[]) {
  return {
    rolePermission: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          hasPermissions.includes(where.permission) ? { id: 'rp-01', ...where } : null,
        ),
      ),
    },
  } as any;
}

describe('[SECURITY] Authorization & Privilege Escalation', () => {
  // ── No decorator → pass-through ────────────────────────────────────────────

  it('should allow route without @RequirePermission (open route)', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, undefined);

    const guard = new PermissionGuard(reflector, makePrisma([]), makeRedisMock());
    const result = await guard.canActivate(makeContext({ user: undefined }));
    expect(result).toBe(true);
  });

  // ── Unauthenticated with @RequirePermission → 401 ─────────────────────────

  it('should reject with Unauthorized when user is undefined', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.read.agency');

    const guard = new PermissionGuard(reflector, makePrisma(['data.ticket.read.agency']), makeRedisMock());
    await expect(guard.canActivate(makeContext({ user: undefined })))
      .rejects.toThrow(UnauthorizedException);
  });

  // ── Missing permission → Forbidden ─────────────────────────────────────────

  it('should reject with Forbidden when role lacks permission', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.delete.tenant');

    const req = {
      user: {
        id:       'u1',
        tenantId: 't1',
        roleId:   'r1',
        agencyId: 'a1',
      },
    };
    const guard = new PermissionGuard(
      reflector,
      makePrisma([]), // aucune permission
      makeRedisMock(),
    );
    await expect(guard.canActivate(makeContext(req)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Has permission → OK, scope context attached ──────────────────────────

  it('should grant access when role has the required permission', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.read.agency');

    const req: any = {
      user: {
        id:       'u1',
        tenantId: 't1',
        roleId:   'r1',
        agencyId: 'a1',
      },
    };
    const guard = new PermissionGuard(
      reflector,
      makePrisma(['data.ticket.read.agency']),
      makeRedisMock(),
    );
    const result = await guard.canActivate(makeContext(req));
    expect(result).toBe(true);

    // Scope context injecté
    expect(req[SCOPE_CONTEXT_KEY]).toMatchObject({
      scope:    'agency',
      tenantId: 't1',
      userId:   'u1',
      agencyId: 'a1',
    });
  });

  // ── Platform tenant without sentinel → Forbidden ──────────────────────────

  it('should reject user attached to platform tenant without sentinel permission', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.read.agency');

    const req = {
      user: {
        id:       'u1',
        tenantId: PLATFORM_TENANT_ID,
        roleId:   'r1',
        agencyId: 'a1',
      },
    };
    const guard = new PermissionGuard(
      reflector,
      makePrisma(['data.ticket.read.agency']), // même avec la perm, sans sentinel
      makeRedisMock(),
    );
    await expect(guard.canActivate(makeContext(req)))
      .rejects.toThrow(ForbiddenException);
  });

  it('should allow platform actor with sentinel permission', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'control.iam.manage.tenant');

    const req = {
      user: {
        id:       'u1',
        tenantId: PLATFORM_TENANT_ID,
        roleId:   'r1',
      },
    };
    const guard = new PermissionGuard(
      reflector,
      makePrisma([
        'control.impersonation.switch.global',
        'control.iam.manage.tenant',
      ]),
      makeRedisMock(),
    );
    const result = await guard.canActivate(makeContext(req));
    expect(result).toBe(true);
  });

  // ── Agency scope without agencyId → Forbidden ──────────────────────────────

  it('should reject agency-scoped permission when actor has no agencyId', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.read.agency');

    const req = {
      user: {
        id:       'u1',
        tenantId: 't1',
        roleId:   'r1',
        // agencyId missing
      },
    };
    const guard = new PermissionGuard(
      reflector,
      makePrisma(['data.ticket.read.agency']),
      makeRedisMock(),
    );
    await expect(guard.canActivate(makeContext(req)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Cache hit ──────────────────────────────────────────────────────────────

  it('should use Redis cache for permission lookups', async () => {
    const reflector = new Reflector();
    stubPerm(reflector, 'data.ticket.read.agency');

    const redis = {
      get:   jest.fn().mockResolvedValue('1'), // cache hit
      setex: jest.fn().mockResolvedValue('OK'),
    } as any;
    const prisma = makePrisma(['data.ticket.read.agency']);
    const guard = new PermissionGuard(reflector, prisma, redis);

    const req = {
      user: { id: 'u1', tenantId: 't1', roleId: 'r1', agencyId: 'a1' },
    };
    const result = await guard.canActivate(makeContext(req));
    expect(result).toBe(true);

    // Cache utilisé → DB pas interrogée
    expect(prisma.rolePermission.findFirst).not.toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalled();
  });

  // ── Array form of @RequirePermission ───────────────────────────────────────

  it('should accept any permission from the array (OR logic)', async () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      'data.staff.read.tenant',
      'data.staff.read.agency',
    ]);

    const req = {
      user: { id: 'u1', tenantId: 't1', roleId: 'r1', agencyId: 'a1' },
    };
    // L'utilisateur n'a QUE la version .agency
    const guard = new PermissionGuard(
      reflector,
      makePrisma(['data.staff.read.agency']),
      makeRedisMock(),
    );
    const result = await guard.canActivate(makeContext(req));
    expect(result).toBe(true);
  });
});
