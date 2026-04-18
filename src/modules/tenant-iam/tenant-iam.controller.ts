/**
 * TenantIamController
 *
 * Routes scopées par tenant : /api/v1/tenants/:tenantId/iam/…
 *
 * Utilisateurs :
 *   GET    /users           — liste
 *   POST   /users           — créer
 *   GET    /users/:userId   — détail
 *   PATCH  /users/:userId   — modifier
 *   DELETE /users/:userId   — supprimer
 *
 * Rôles :
 *   GET    /roles             — liste
 *   POST   /roles             — créer
 *   GET    /roles/:roleId     — détail + permissions
 *   PATCH  /roles/:roleId     — renommer
 *   DELETE /roles/:roleId     — supprimer
 *   PUT    /roles/:roleId/permissions — remplacer toutes les permissions
 *
 * Sessions :
 *   GET    /sessions           — sessions actives
 *   DELETE /sessions/:id       — révoquer
 *
 * Journal :
 *   GET    /audit              — logs paginés (filtres: userId, action, level, from, to)
 */
import {
  Controller, Get, Post, Patch, Put, Delete,
  Param, Body, Query, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantIamService }    from './tenant-iam.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { RequirePermission }   from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission }          from '../../common/constants/permissions';
import {
  CreateUserDto, UpdateUserDto,
  CreateRoleDto, UpdateRoleDto, SetPermissionsDto,
  AuditQueryDto,
} from './dto/tenant-iam.dto';
import {
  AdminInitiateResetDto, BatchUserIdsDto,
} from '../password-reset/dto/password-reset.dto';

function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (process.env.NODE_ENV === 'production' && typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
  }
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

@Controller({ version: '1', path: 'tenants/:tenantId/iam' })
export class TenantIamController {
  constructor(
    private readonly iam:           TenantIamService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  // ─── Utilisateurs ──────────────────────────────────────────────────────────

  @Get('users')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  listUsers(
    @Param('tenantId') tenantId: string,
    @Query('search')   search?:  string,
    @Query('roleId')   roleId?:  string,
  ) {
    return this.iam.listUsers(tenantId, search, roleId);
  }

  @Post('users')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  createUser(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      CreateUserDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.createUser(tenantId, dto, actor.id);
  }

  @Get('users/:userId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  getUser(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
  ) {
    return this.iam.getUser(tenantId, userId);
  }

  @Patch('users/:userId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  updateUser(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @Body()            dto:      UpdateUserDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.updateUser(tenantId, userId, dto, actor.id);
  }

  @Delete('users/:userId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.deleteUser(tenantId, userId, actor.id);
  }

  @Patch('users/:userId/toggle-active')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  toggleUserActive(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.toggleUserActive(tenantId, userId, actor.id);
  }

  /**
   * Reset du mot de passe d'un user par un admin.
   * Mode 'link' : retourne un lien à transmettre hors-bande (email à venir).
   * Mode 'set'  : applique immédiatement un mdp fourni + force rotation au prochain login.
   */
  @Post('users/:userId/reset-password')
  @RequirePermission(Permission.USER_RESET_PASSWORD_TENANT)
  @HttpCode(HttpStatus.OK)
  async resetUserPassword(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @Body()            dto:      AdminInitiateResetDto,
    @CurrentUser()     actor:    CurrentUserPayload,
    @Req()             req:      Request,
  ) {
    return this.passwordReset.initiateByAdmin({
      actorTenantId: tenantId,
      actorId:       actor.id,
      targetUserId:  userId,
      mode:          dto.mode,
      newPassword:   dto.newPassword,
      ipAddress:     extractIp(req),
    });
  }

  /**
   * Batch — envoi d'un lien de reset à plusieurs users (mode 'link' uniquement).
   * Le mode 'set' en batch est interdit (trop dangereux).
   */
  @Post('users/batch/reset-password')
  @RequirePermission(Permission.USER_RESET_PASSWORD_TENANT)
  @HttpCode(HttpStatus.OK)
  async batchResetPassword(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      BatchUserIdsDto,
    @CurrentUser()     actor:    CurrentUserPayload,
    @Req()             req:      Request,
  ) {
    return this.passwordReset.initiateByAdminBatch({
      actorTenantId: tenantId,
      actorId:       actor.id,
      targetUserIds: dto.userIds,
      ipAddress:     extractIp(req),
    });
  }

  /**
   * Batch — suppression de plusieurs users. Transaction atomique ; l'actor
   * ne peut pas se supprimer lui-même (même logique que deleteUser).
   */
  @Post('users/batch/delete')
  @RequirePermission(Permission.USER_BULK_DELETE_TENANT)
  @HttpCode(HttpStatus.OK)
  async batchDelete(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      BatchUserIdsDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.batchDeleteUsers(tenantId, dto.userIds, actor.id);
  }

  // ─── Rôles ────────────────────────────────────────────────────────────────

  @Get('roles')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  listRoles(@Param('tenantId') tenantId: string) {
    return this.iam.listRoles(tenantId);
  }

  @Post('roles')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  createRole(
    @Param('tenantId') tenantId: string,
    @Body()            dto:      CreateRoleDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.createRole(tenantId, dto, actor.id);
  }

  @Get('roles/:roleId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  getRole(
    @Param('tenantId') tenantId: string,
    @Param('roleId')   roleId:   string,
  ) {
    return this.iam.getRole(tenantId, roleId);
  }

  @Patch('roles/:roleId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  updateRole(
    @Param('tenantId') tenantId: string,
    @Param('roleId')   roleId:   string,
    @Body()            dto:      UpdateRoleDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.updateRole(tenantId, roleId, dto, actor.id);
  }

  @Delete('roles/:roleId')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRole(
    @Param('tenantId') tenantId: string,
    @Param('roleId')   roleId:   string,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.deleteRole(tenantId, roleId, actor.id);
  }

  @Put('roles/:roleId/permissions')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  setPermissions(
    @Param('tenantId') tenantId: string,
    @Param('roleId')   roleId:   string,
    @Body()            dto:      SetPermissionsDto,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.setPermissions(tenantId, roleId, dto, actor.id);
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  @Get('sessions')
  @RequirePermission(Permission.SESSION_REVOKE_TENANT)
  listSessions(@Param('tenantId') tenantId: string) {
    return this.iam.listSessions(tenantId);
  }

  @Delete('sessions/:sessionId')
  @RequirePermission(Permission.SESSION_REVOKE_TENANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(
    @Param('tenantId')  tenantId:  string,
    @Param('sessionId') sessionId: string,
    @CurrentUser()      actor:     CurrentUserPayload,
  ) {
    return this.iam.revokeSession(tenantId, sessionId, actor.id);
  }

  /**
   * Révoque toutes les sessions actives d'un user — force la reconnexion.
   * À utiliser après changement de rôle critique ou suspicion de compromission.
   */
  @Post('users/:userId/revoke-sessions')
  @RequirePermission(Permission.SESSION_REVOKE_TENANT)
  @HttpCode(HttpStatus.OK)
  revokeUserSessions(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @CurrentUser()     actor:    CurrentUserPayload,
  ) {
    return this.iam.revokeUserSessions(tenantId, userId, actor.id);
  }

  // ─── Détail utilisateur : sessions + historique ──────────────────────────

  @Get('users/:userId/sessions')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  listUserSessions(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
  ) {
    return this.iam.listUserSessions(tenantId, userId);
  }

  @Get('users/:userId/login-history')
  @RequirePermission(Permission.IAM_MANAGE_TENANT)
  getUserLoginHistory(
    @Param('tenantId') tenantId: string,
    @Param('userId')   userId:   string,
    @Query('limit')    limit?:   string,
  ) {
    return this.iam.getUserLoginHistory(tenantId, userId, limit ? parseInt(limit, 10) : 50);
  }

  // ─── Journal d'accès ──────────────────────────────────────────────────────

  @Get('audit')
  @RequirePermission(Permission.IAM_AUDIT_TENANT)
  listAuditLogs(
    @Param('tenantId') tenantId: string,
    @Query()           query:    AuditQueryDto,
  ) {
    return this.iam.listAuditLogs(tenantId, query);
  }
}
