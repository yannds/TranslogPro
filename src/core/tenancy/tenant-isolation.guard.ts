/**
 * TenantIsolationGuard — Garde-fou anti-smuggling cross-tenant.
 *
 * RÈGLE : si une requête contient À LA FOIS un session.tenantId (cookie) et
 * un host.tenantId (Host header), les deux DOIVENT être égaux.
 *
 * Sinon → 403 immédiat, pas de fallback, pas de warning silencieux.
 *
 * C'est la brique qui garantit qu'un cookie volé/replay depuis un autre
 * sous-domaine ne peut pas être utilisé contre un tenant étranger.
 *
 * EXCEPTIONS CONTRÔLÉES :
 *
 *   1. Super-admin plateforme (session.tenantId = PLATFORM_TENANT_ID)
 *      peut frapper n'importe quel tenant — c'est le flow d'impersonation
 *      pré-Phase 2 (X-Impersonation-Token) où la session reste plateforme
 *      et l'override vient du header.
 *
 *   2. Aucun host résolu (req.resolvedHostTenant absent) : pas d'isolation
 *      possible, on laisse passer. Les routes sensibles doivent dépendre de
 *      @RequirePermission + PermissionGuard pour leur sécurité (défense en
 *      profondeur). TenantIsolationGuard n'est qu'une couche supplémentaire.
 *
 *   3. Aucune session (req.user absent) : pas de conflit possible, on laisse
 *      passer. Les routes protégées sont déjà bloquées par PermissionGuard.
 *
 * CE GUARD N'EST PAS APPE GLOBALEMENT dans la Phase 1 initiale — il est
 * wiré manuellement via APP_GUARD une fois le cutover terminé. Pendant la
 * transition où `app.translogpro.com` (sans sous-domaine tenant) reste
 * accessible, l'activation trop précoce casserait le login.
 *
 * ACTIVATION : voir PHASE1_CUTOVER.md, section "Activation guard isolation".
 */

import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { PLATFORM_TENANT_ID } from './tenant-resolver.service';

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  private readonly logger = new Logger(TenantIsolationGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const sessionTenantId = req.user?.tenantId;
    const hostTenantId    = req.resolvedHostTenant?.tenantId;

    // Cas 1 : ni session ni host → pas d'isolation à vérifier
    if (!sessionTenantId && !hostTenantId) return true;

    // Cas 2 : session sans host → fine (Bearer token dans tests, health, etc.)
    if (sessionTenantId && !hostTenantId) return true;

    // Cas 3 : host sans session → fine (route publique tenant-scoped, sans auth)
    if (!sessionTenantId && hostTenantId) return true;

    // Cas 4 : les deux présents → ils doivent matcher
    if (sessionTenantId === hostTenantId) return true;

    // Cas 5 : super-admin plateforme peut frapper n'importe où
    if (sessionTenantId === PLATFORM_TENANT_ID) return true;

    // Cas 6 : impersonation en cours → le guard regarde le tenant cible
    // (déjà exposé par ImpersonationGuard dans req.impersonation)
    if (req.impersonation?.targetTenantId === hostTenantId) return true;

    // MISMATCH → log audit + 403
    this.logger.warn(
      `[TenantIsolation] BLOCKED — session.tenantId=${sessionTenantId} ` +
      `host.tenantId=${hostTenantId} ` +
      `host=${req.resolvedHostTenant?.hostname} ` +
      `user=${req.user?.id} ` +
      `path=${req.path}`,
    );

    throw new ForbiddenException(
      'Cross-tenant request rejected — session and host tenants mismatch',
    );
  }
}
