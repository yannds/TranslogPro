import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserPayload {
  id:        string;
  tenantId:  string;
  roleId:    string;    // DB Role.id — utilisé par PermissionGuard et WorkflowEngine
  roleName:  string;    // Role.name — usage : logs et audit uniquement, JAMAIS logique d'accès
  agencyId?: string;
  userType?: string;    // STAFF | VOYAGEUR | ANONYMOUS
}

/**
 * Extracts the authenticated user from the request.
 * Populated by the Better Auth session middleware.
 *
 * Usage: `@CurrentUser() user: CurrentUserPayload`
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const req = ctx.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    if (!req.user) throw new Error('CurrentUser decorator used on unauthenticated route');
    return req.user;
  },
);
