/**
 * PlatformIamController — endpoints cross-tenant pour le staff plateforme.
 *
 * Routes sous /api/platform/iam :
 *   GET    /audit                       — journal cross-tenant (filtres : tenantId, level, action, userId, from, to)
 *   GET    /sessions                    — sessions actives cross-tenant (filtres : tenantId, userId)
 *   DELETE /sessions/:sessionId         — révoque n'importe quelle session
 *   GET    /users                       — utilisateurs cross-tenant (filtres : tenantId, search, userType)
 *   POST   /users/:userId/reset-mfa     — reset MFA utilisateur (escalade verrouillage)
 *   GET    /roles                       — rôles plateforme (read-only) + permissions
 *
 * Sécurité :
 *   Chaque route exige une permission .global couvrant un scope plateforme.
 *   Le PermissionGuard applique le check ; il rejette automatiquement les
 *   acteurs dont le tenantId ≠ PLATFORM_TENANT_ID pour ces permissions globales.
 */
import {
  Controller, Get, Post, Delete, Body, Req,
  Param, Query, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformIamService } from './platform-iam.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import {
  PlatformAuditQueryDto,
  PlatformUsersQueryDto,
  PlatformSessionsQueryDto,
} from './dto/platform-iam.dto';
import { RequirePermission }   from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/constants/permissions';

/** Corps de requête pour la réinitialisation cross-tenant. */
interface PlatformResetPasswordBody {
  mode:         'link' | 'set';
  newPassword?: string;
}

function extractIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim() ?? req.ip ?? '';
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

@Controller('platform/iam')
export class PlatformIamController {
  constructor(
    private readonly iam:           PlatformIamService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  // ─── Audit ──────────────────────────────────────────────────────────────────

  @Get('audit')
  @RequirePermission(Permission.PLATFORM_AUDIT_READ_GLOBAL)
  listAuditLogs(@Query() query: PlatformAuditQueryDto) {
    return this.iam.listAuditLogs(query);
  }

  // ─── Sessions ───────────────────────────────────────────────────────────────

  @Get('sessions')
  @RequirePermission(Permission.PLATFORM_SESSION_REVOKE_GLOBAL)
  listSessions(@Query() query: PlatformSessionsQueryDto) {
    return this.iam.listSessions(query);
  }

  @Delete('sessions/:sessionId')
  @RequirePermission(Permission.PLATFORM_SESSION_REVOKE_GLOBAL)
  @HttpCode(HttpStatus.OK)
  revokeSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser()      actor:     CurrentUserPayload,
  ) {
    return this.iam.revokeSession(sessionId, actor.id);
  }

  // ─── Users (cross-tenant, diagnostic support) ──────────────────────────────

  @Get('users')
  @RequirePermission(Permission.PLATFORM_IAM_READ_GLOBAL)
  listUsers(@Query() query: PlatformUsersQueryDto) {
    return this.iam.listUsers(query);
  }

  @Post('users/:userId/reset-mfa')
  @RequirePermission(Permission.PLATFORM_MFA_RESET_GLOBAL)
  @HttpCode(HttpStatus.OK)
  resetMfa(
    @Param('userId') userId: string,
    @CurrentUser()   actor:  CurrentUserPayload,
  ) {
    return this.iam.resetMfa(userId, actor.id);
  }

  /**
   * Réinitialisation du mot de passe d'un utilisateur cross-tenant.
   * Réservé aux rôles plateforme (SUPER_ADMIN, SUPPORT_L2).
   *
   *   - mode 'link' : renvoie un resetUrl signé (TTL 30 min) à transmettre
   *                   hors-bande. Tous les sessions du user sont préservés.
   *   - mode 'set'  : applique immédiatement un nouveau mot de passe, force
   *                   la rotation au prochain login (forcePasswordChange=true)
   *                   et invalide toutes les sessions actives du user.
   */
  @Post('users/:userId/reset-password')
  @RequirePermission(Permission.PLATFORM_USER_RESET_PWD_GLOBAL)
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('userId') userId: string,
    @Body()          body:   PlatformResetPasswordBody,
    @CurrentUser()   actor:  CurrentUserPayload,
    @Req()           req:    Request,
  ) {
    if (body?.mode !== 'link' && body?.mode !== 'set') {
      throw new BadRequestException('mode doit être "link" ou "set"');
    }
    if (body.mode === 'set' && !body.newPassword) {
      throw new BadRequestException('newPassword requis en mode "set"');
    }
    return this.passwordReset.initiateByPlatformAdmin({
      actorId:      actor.id,
      targetUserId: userId,
      mode:         body.mode,
      newPassword:  body.newPassword,
      ipAddress:    extractIp(req),
    });
  }

  // ─── Roles (vue read-only des rôles plateforme système) ──────────────────

  @Get('roles')
  @RequirePermission(Permission.PLATFORM_IAM_READ_GLOBAL)
  listRoles() {
    return this.iam.listPlatformRoles();
  }
}
