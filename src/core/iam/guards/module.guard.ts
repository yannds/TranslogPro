import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { MODULE_KEY } from '../../../common/decorators/require-module.decorator';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/eventbus/redis-publisher.service';
import { SCOPE_CONTEXT_KEY } from './permission.guard';

/**
 * ModuleGuard — vérifie qu'un module SaaS est installé ET actif pour le tenant.
 *
 * Déclenché uniquement sur les routes décorées avec @RequireModule('KEY').
 * Sans ce décorateur, le guard laisse passer (routes sans module requis).
 *
 * Ordre d'exécution recommandé :
 *   ImpersonationGuard → PermissionGuard → ModuleGuard
 * (PermissionGuard attache ScopeContext qui contient l'effectiveTenantId)
 *
 * Cache Redis :
 *   module:{tenantId}:{moduleKey} → '1' (actif) | '0' (inactif/absent)
 *   TTL : 300s (les (dés)installations de modules sont rares)
 *   Invalidation : AppModuleService.setActive() doit appeler invalidateModuleCache()
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma:    PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireModule → open to any tenant
    if (!moduleKey) return true;

    const req = context.switchToHttp().getRequest<Request & {
      user?: { tenantId?: string };
      [SCOPE_CONTEXT_KEY]?: { tenantId: string };
    }>();

    // Prefer effectiveTenantId set by PermissionGuard (handles impersonation).
    // Fall back to req.user.tenantId for routes with no @RequirePermission.
    const tenantId = req[SCOPE_CONTEXT_KEY]?.tenantId ?? req.user?.tenantId;

    if (!tenantId) {
      // Unauthenticated — PermissionGuard would already have rejected; be safe.
      throw new ForbiddenException('Module check requires an authenticated tenant context');
    }

    const active = await this.isModuleActive(tenantId, moduleKey);

    if (!active) {
      throw new ForbiddenException(
        `Module "${moduleKey}" is not activated for this tenant`,
      );
    }

    return true;
  }

  /**
   * Vérifie si un module est actif pour un tenant.
   * Cache Redis TTL 300s — invalider via invalidateModuleCache() lors d'un changement.
   */
  async isModuleActive(tenantId: string, moduleKey: string): Promise<boolean> {
    const cacheKey = `module:${tenantId}:${moduleKey}`;

    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === '1';

    const installed = await this.prisma.installedModule.findUnique({
      where:  { tenantId_moduleKey: { tenantId, moduleKey } },
      select: { isActive: true },
    });

    const active = installed?.isActive === true;
    this.redis.setex(cacheKey, 300, active ? '1' : '0').catch(() => {/* non-critical */});

    return active;
  }

  /**
   * Invalide le cache pour un module donné.
   * À appeler depuis AppModuleService lors d'une installation, désinstallation
   * ou changement d'état (isActive toggle).
   */
  async invalidateModuleCache(tenantId: string, moduleKey: string): Promise<void> {
    await this.redis.del(`module:${tenantId}:${moduleKey}`);
  }
}
