import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the tenantId from the authenticated request.
 * The value is set by RlsMiddleware from the Better Auth session.
 *
 * Usage: `@TenantId() tenantId: string`
 */
export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new Error('TenantId decorator used on unauthenticated route');
    return tenantId;
  },
);
