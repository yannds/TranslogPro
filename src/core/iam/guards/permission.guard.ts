import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { Permission, ROLE_PERMISSIONS, extractScope, PermissionScope } from '../../../common/constants/permissions';
import { Request } from 'express';

/**
 * Injected into every request by the guard.
 * Services read this to build tenant-scoped Prisma WHERE clauses.
 *
 * Examples:
 *   scope = 'own'    → WHERE userId    = scopeCtx.userId
 *   scope = 'agency' → WHERE agencyId  = scopeCtx.agencyId
 *   scope = 'tenant' → WHERE tenantId  = scopeCtx.tenantId   (default)
 *   scope = 'global' → no extra filter (SuperAdmin only)
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
    role?:     string;
    agencyId?: string;
  };
  [SCOPE_CONTEXT_KEY]?: ScopeContext;
};

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequirePermission → open route (health checks, public display)
    if (!required) return true;

    const req  = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;

    if (!user?.id || !user.tenantId || !user.role) {
      throw new UnauthorizedException('Authentication required');
    }

    // ── 1. Role-based check ───────────────────────────────────────────────
    const allowed = ROLE_PERMISSIONS[user.role] ?? [];
    if (!allowed.includes(required)) {
      throw new ForbiddenException(
        `Role "${user.role}" lacks permission "${required}"`,
      );
    }

    // ── 2. Scope derivation ───────────────────────────────────────────────
    const scope = extractScope(required);

    // agency-scoped permission requires the actor to have an agencyId
    if (scope === 'agency' && !user.agencyId) {
      throw new ForbiddenException(
        `Permission "${required}" requires agency scope but actor has no agencyId`,
      );
    }

    // global scope is reserved for SUPER_ADMIN
    if (scope === 'global' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        `Permission "${required}" requires global scope (SuperAdmin only)`,
      );
    }

    // ── 3. Attach ScopeContext to the request ─────────────────────────────
    // Services read req[SCOPE_CONTEXT_KEY] to build Prisma WHERE clauses.
    req[SCOPE_CONTEXT_KEY] = {
      scope,
      tenantId: user.tenantId,
      userId:   user.id,
      agencyId: user.agencyId,
    };

    return true;
  }
}
