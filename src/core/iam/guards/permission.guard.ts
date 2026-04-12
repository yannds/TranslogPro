import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { Permission, extractScope, PermissionScope } from '../../../common/constants/permissions';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/eventbus/redis-publisher.service';
import { Request } from 'express';

/**
 * Injected into every request by the guard.
 * Services read this to build tenant-scoped Prisma WHERE clauses.
 */
export interface ScopeContext {
  scope:    PermissionScope;
  tenantId: string;
  userId:   string;
  agencyId: string | undefined;
}

export const SCOPE_CONTEXT_KEY = '__scope_context__';

type AuthenticatedRequest = Request & {
  user?: {
    id?:       string;
    tenantId?: string;
    roleId?:   string;
    agencyId?: string;
  };
  [SCOPE_CONTEXT_KEY]?: ScopeContext;
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma:    PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequirePermission → open route (health checks, public display)
    if (!required) return true;

    const req  = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user?.id || !user.tenantId || !user.roleId) {
      throw new UnauthorizedException('Authentication required');
    }

    // ── 1. DB check with Redis cache (TTL 60s) ────────────────────────────
    const granted = await this.hasPermission(user.roleId, required);
    if (!granted) {
      throw new ForbiddenException(
        `Role lacks permission "${required}"`,
      );
    }

    // ── 2. Scope derivation ───────────────────────────────────────────────
    const scope = extractScope(required);

    if (scope === 'agency' && !user.agencyId) {
      throw new ForbiddenException(
        `Permission "${required}" requires agency scope but actor has no agencyId`,
      );
    }

    // global scope: verified via DB (SUPER_ADMIN role has the permission seeded)
    // No hardcoded role name check — the RolePermission row is the authority.

    // ── 3. Attach ScopeContext to the request ─────────────────────────────
    req[SCOPE_CONTEXT_KEY] = {
      scope,
      tenantId: user.tenantId,
      userId:   user.id,
      agencyId: user.agencyId,
    };

    return true;
  }

  /**
   * Vérifie si un rôle possède une permission.
   * Cache Redis : iam:perm:{roleId}:{permission} — TTL 60s
   * Invalidé sur control.iam.manage.tenant via RbacService.invalidateCache()
   */
  async hasPermission(roleId: string, permission: string): Promise<boolean> {
    const cacheKey = `iam:perm:${roleId}:${permission}`;

    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === '1';

    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId, permission },
    });

    const granted = rp !== null;
    // Fire-and-forget — cache miss cost is one DB query; don't block on cache write
    this.redis.setex(cacheKey, 60, granted ? '1' : '0').catch(() => {/* non-critical */});

    return granted;
  }
}
