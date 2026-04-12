import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { ImpersonationService } from '../services/impersonation.service';
import { PLATFORM_TENANT_ID } from './permission.guard';

const IMPERSONATION_HEADER = 'x-impersonation-token';

/**
 * ImpersonationGuard — PRD §IV.12
 *
 * Ce guard s'exécute sur les routes qui acceptent un token JIT d'impersonation.
 * Il s'applique en AMONT du PermissionGuard.
 *
 * Rôle :
 *   1. Détecter le header X-Impersonation-Token.
 *   2. Vérifier que l'acteur (session normale) est bien un agent plateforme
 *      (tenantId === PLATFORM_TENANT_ID).
 *   3. Valider le token via ImpersonationService (signature + DB + TTL).
 *   4. Injecter req.impersonation pour que PermissionGuard et RlsMiddleware
 *      puissent utiliser le targetTenantId comme tenantId effectif.
 *
 * Comportement si pas de header :
 *   → Le guard laisse passer (impersonation optionnelle).
 *   → PermissionGuard utilisera le tenantId de la session normale.
 *
 * IMPORTANT : Ce guard ne vérifie PAS la permission control.impersonation.switch.global.
 * Cette permission est vérifiée par PermissionGuard sur l'endpoint /iam/impersonate
 * (via @RequirePermission). Ce guard vérifie UNIQUEMENT la validité du token présenté.
 */
@Injectable()
export class ImpersonationGuard implements CanActivate {
  constructor(
    private readonly impersonationService: ImpersonationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & {
      user?: { id?: string; tenantId?: string; roleId?: string };
      impersonation?: {
        sessionId:      string;
        targetTenantId: string;
        actorId:        string;
        actorTenantId:  string;
      };
    }>();

    const rawToken = req.headers[IMPERSONATION_HEADER] as string | undefined;

    // Pas de token d'impersonation → flow normal
    if (!rawToken) return true;

    // Vérifier que l'acteur est bien un agent plateforme
    if (req.user?.tenantId !== PLATFORM_TENANT_ID) {
      throw new ForbiddenException(
        'Token d\'impersonation présenté par un acteur non-plateforme',
      );
    }

    // Valider le token (signature, TTL, statut DB)
    let ctx: Awaited<ReturnType<typeof this.impersonationService.verifyToken>>;
    try {
      ctx = await this.impersonationService.verifyToken(rawToken);
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException('Token d\'impersonation invalide');
    }

    // Cohérence acteur : le token doit appartenir à l'utilisateur courant
    if (ctx.actorId !== req.user?.id) {
      throw new ForbiddenException(
        'Token d\'impersonation émis pour un autre acteur',
      );
    }

    // Injecter le contexte d'impersonation — lu par PermissionGuard
    req.impersonation = {
      sessionId:      ctx.sessionId,
      targetTenantId: ctx.targetTenantId,
      actorId:        ctx.actorId,
      actorTenantId:  ctx.actorTenantId,
    };

    return true;
  }
}
