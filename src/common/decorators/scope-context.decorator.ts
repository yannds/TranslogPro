import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ScopeContext, SCOPE_CONTEXT_KEY } from '../../core/iam/guards/permission.guard';
import { Request } from 'express';

/**
 * Extracts the ScopeContext attached by PermissionGuard.
 * Services use this to build tenant-scoped Prisma WHERE clauses.
 *
 * Usage:
 *   findAll(@ScopeCtx() scope: ScopeContext) {
 *     return this.service.findAll(scope);
 *   }
 *
 * In service:
 *   buildFilter(scope: ScopeContext) {
 *     if (scope.scope === 'agency') return { agencyId: scope.agencyId };
 *     if (scope.scope === 'own')    return { userId:   scope.userId };
 *     return {};  // tenant — RLS handles it
 *   }
 */
export const ScopeCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ScopeContext => {
    const req = ctx.switchToHttp().getRequest<Request & { [key: string]: unknown }>();
    const sc  = req[SCOPE_CONTEXT_KEY] as ScopeContext | undefined;
    if (!sc) throw new Error('ScopeCtx used on route without @RequirePermission');
    return sc;
  },
);

export { ScopeContext };
