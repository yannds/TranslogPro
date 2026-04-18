import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ImpersonationService } from '../services/impersonation.service';
import { PermissionGuard, SCOPE_CONTEXT_KEY } from '../guards/permission.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  P_IMPERSONATION_SWITCH_GLOBAL,
  P_IMPERSONATION_REVOKE_GLOBAL,
} from '../../../common/constants/permissions';

class SwitchSessionDto {
  @IsString()
  targetTenantId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

type AuthenticatedRequest = Request & {
  user?: { id?: string; tenantId?: string; roleId?: string };
  [SCOPE_CONTEXT_KEY]?: { userId: string };
};

/**
 * ImpersonationController — PRD §IV.12
 *
 * Endpoints réservés aux agents du tenant plateforme (SUPER_ADMIN, SUPPORT_L1/L2).
 * Tous les endpoints sont protégés par @RequirePermission — le PermissionGuard
 * valide à la fois la permission ET que l'acteur est bien sur le tenant 00000000-...
 *
 * Routes :
 *   POST   /iam/impersonate              → Crée une session JIT (switch)
 *   DELETE /iam/impersonate/:sessionId   → Révoque une session active
 *   GET    /iam/impersonate/:tenantId/active → Liste les sessions actives (audit)
 */
@Controller('iam/impersonate')
@UseGuards(PermissionGuard)
export class ImpersonationController {
  constructor(
    private readonly impersonationService: ImpersonationService,
  ) {}

  /**
   * POST /iam/impersonate
   *
   * Crée une session JIT sur le tenant cible.
   * Requiert : control.impersonation.switch.global
   *
   * Response : { token, sessionId, expiresAt }
   * Le token est retourné UNE SEULE FOIS — le stocker côté client.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(P_IMPERSONATION_SWITCH_GLOBAL)
  async switchSession(
    @Body() dto:  SwitchSessionDto,
    @Req()  req:  AuthenticatedRequest,
  ) {
    const actorId = req.user?.id;
    if (!actorId) {
      // Ne devrait jamais arriver — PermissionGuard garantit l'auth
      throw new Error('Actor ID manquant après vérification du guard');
    }

    const result = await this.impersonationService.switchSession(
      actorId,
      dto.targetTenantId,
      {
        reason:    dto.reason,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );

    return {
      token:       result.token,
      sessionId:   result.sessionId,
      expiresAt:   result.expiresAt.toISOString(),
      // Phase 2 cross-subdomain — le frontend admin redirige la fenêtre
      // vers cette URL sur le sous-domaine du tenant cible. Le endpoint
      // /api/auth/impersonate/exchange là-bas échange le token contre un
      // cookie scopé, puis redirige vers /admin du tenant.
      redirectUrl: result.redirectUrl,
      targetSlug:  result.targetSlug,
      message:     'Session d\'impersonation créée. Token valide 15 minutes. Non-renouvelable. ' +
                   'Charger redirectUrl pour basculer sur le sous-domaine du tenant.',
    };
  }

  /**
   * DELETE /iam/impersonate/:sessionId
   *
   * Révoque une session d'impersonation active.
   * Requiert : control.impersonation.revoke.global (SUPER_ADMIN ou SUPPORT_L2)
   */
  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(P_IMPERSONATION_REVOKE_GLOBAL)
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req()              req:       AuthenticatedRequest,
  ): Promise<void> {
    const revokedById = req[SCOPE_CONTEXT_KEY]?.userId ?? req.user?.id ?? 'unknown';
    await this.impersonationService.revokeSession(
      sessionId,
      revokedById,
      req.ip,
    );
  }

  /**
   * DELETE /iam/impersonate/:sessionId/self
   *
   * Termine sa PROPRE session d'impersonation (self-service). Permet à un
   * SUPPORT_L1 — qui n'a pas la perm revoke.global — de quitter le tenant
   * cible proprement via le bouton "Terminer" du banner. Côté backend, on
   * vérifie que l'acteur courant est bien l'acteur initial de la session.
   *
   * Requiert seulement : control.impersonation.switch.global (que tout
   * acteur habilité à créer une session possède).
   */
  @Delete(':sessionId/self')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(P_IMPERSONATION_SWITCH_GLOBAL)
  async terminateOwnSession(
    @Param('sessionId') sessionId: string,
    @Req()              req:       AuthenticatedRequest,
  ): Promise<void> {
    const actorId = req.user?.id ?? req[SCOPE_CONTEXT_KEY]?.userId;
    if (!actorId) throw new Error('Actor ID manquant après vérification du guard');
    await this.impersonationService.terminateOwnSession(sessionId, actorId, req.ip);
  }

  /**
   * GET /iam/impersonate/:tenantId/active
   *
   * Liste les sessions d'impersonation actives sur un tenant (pour audit).
   * Requiert : control.impersonation.revoke.global
   */
  @Get(':tenantId/active')
  @RequirePermission(P_IMPERSONATION_REVOKE_GLOBAL)
  async listActiveSessions(
    @Param('tenantId') tenantId: string,
  ) {
    const sessions = await this.impersonationService.listActiveSessions(tenantId);
    return { sessions };
  }

  /**
   * GET /iam/impersonate/:tenantId/history
   *
   * Historique complet (tous statuts) des sessions d'impersonation pour
   * un tenant — audit, conformité, support. Limite 200 entrées par défaut.
   * Requiert : control.impersonation.revoke.global (SA / SUPPORT_L2).
   */
  @Get(':tenantId/history')
  @RequirePermission(P_IMPERSONATION_REVOKE_GLOBAL)
  async listHistory(
    @Param('tenantId') tenantId: string,
  ) {
    const sessions = await this.impersonationService.listHistoryByTenant(tenantId);
    return { sessions };
  }

  /**
   * GET /iam/impersonate/my-active
   *
   * Sessions d'impersonation actives initiées par l'acteur courant,
   * tous tenants confondus. Alimente le dashboard plateforme pour
   * permettre à l'utilisateur de rejoindre l'un de ses tenants cibles
   * en cours de session (cookie déjà posé sur le sous-domaine cible).
   *
   * Requiert : control.impersonation.switch.global (déjà possédé par
   * l'acteur pour avoir créé les sessions).
   */
  @Get('my-active')
  @RequirePermission(P_IMPERSONATION_SWITCH_GLOBAL)
  async listMyActiveSessions(
    @Req() req: AuthenticatedRequest,
  ) {
    const actorId = req.user?.id;
    if (!actorId) throw new Error('Actor ID manquant après vérification du guard');
    const sessions = await this.impersonationService.listActiveByActor(actorId);
    return { sessions };
  }
}
