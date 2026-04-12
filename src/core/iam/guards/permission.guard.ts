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
 * ID canonique du tenant plateforme (nil UUID RFC 4122).
 * Copié ici pour éviter une dépendance circulaire avec le seed.
 * Source de vérité : PLATFORM_TENANT_ID dans iam.seed.ts.
 */
export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Permission minimale requise pour qu'un user puisse être rattaché
 * au tenant plateforme. Tout user sans cette permission sur ce tenant
 * est rejeté immédiatement (SECURITY VIOLATION).
 */
const PLATFORM_SENTINEL_PERMISSION = 'control.impersonation.switch.global';

/**
 * Injected into every request by the guard.
 * Services read this to build tenant-scoped Prisma WHERE clauses.
 */
export interface ScopeContext {
  scope:           PermissionScope;
  tenantId:        string;
  userId:          string;
  agencyId:        string | undefined;
  /** true si la requête opère sous une session d'impersonation JIT */
  isImpersonating: boolean;
  /** tenantId réel de l'acteur (toujours 00000000-... en impersonation) */
  actorTenantId:   string;
}

export const SCOPE_CONTEXT_KEY = '__scope_context__';

type AuthenticatedRequest = Request & {
  user?: {
    id?:       string;
    tenantId?: string;
    roleId?:   string;
    agencyId?: string;
  };
  /** Injecté par ImpersonationGuard si token JIT présent */
  impersonation?: {
    sessionId:      string;
    targetTenantId: string;
    actorId:        string;
    actorTenantId:  string;
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

    // ── 1. PLATFORM TENANT GUARD ──────────────────────────────────────────────
    // Si l'utilisateur est rattaché au tenant plateforme (00000000-...),
    // il DOIT posséder au moins la permission sentinelle (switch.global).
    // Cela empêche toute assignation accidentelle d'un user standard à ce tenant.
    if (user.tenantId === PLATFORM_TENANT_ID) {
      const isPlatformActor = await this.hasPermission(user.roleId, PLATFORM_SENTINEL_PERMISSION);
      if (!isPlatformActor) {
        // Log sécurité critique — ne pas exposer le détail à l'appelant
        throw new ForbiddenException(
          'Access denied — platform tenant reserved for system actors',
        );
      }
    }

    // ── 2. Résolution du tenantId effectif (impersonation JIT) ───────────────
    // Si une session d'impersonation est active (injectée par ImpersonationGuard),
    // le tenantId effectif est celui du tenant cible, pas celui de l'acteur.
    // L'acteur conserve son roleId original pour la vérification de permission.
    const isImpersonating = !!req.impersonation;
    const effectiveTenantId = isImpersonating
      ? req.impersonation!.targetTenantId
      : user.tenantId;

    // ── 3. DB check with Redis cache (TTL 60s) ────────────────────────────────
    const granted = await this.hasPermission(user.roleId, required);
    if (!granted) {
      throw new ForbiddenException(
        `Role lacks permission "${required}"`,
      );
    }

    // ── 4. Scope derivation ───────────────────────────────────────────────────
    const scope = extractScope(required);

    if (scope === 'agency' && !user.agencyId) {
      throw new ForbiddenException(
        `Permission "${required}" requires agency scope but actor has no agencyId`,
      );
    }

    // global scope: vérifié via DB (pas de hardcode de nom de rôle)

    // ── 5. Attach ScopeContext to the request ──────────────────────────────────
    req[SCOPE_CONTEXT_KEY] = {
      scope,
      tenantId:        effectiveTenantId,
      userId:          user.id,
      agencyId:        user.agencyId,
      isImpersonating,
      actorTenantId:   user.tenantId,
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
    // Fire-and-forget — cache miss cost est une requête DB ; ne pas bloquer
    this.redis.setex(cacheKey, 60, granted ? '1' : '0').catch(() => {/* non-critical */});

    return granted;
  }
}
