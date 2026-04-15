/**
 * TenantIamService
 *
 * CRUD complet pour la gestion des utilisateurs, rôles et permissions
 * d'un tenant, plus lecture des sessions actives et du journal d'accès.
 *
 * Endpoints consommés par les pages IAM du frontend Admin :
 *   Utilisateurs : list / create / update / delete
 *   Rôles        : list / create / update / delete / set-permissions
 *   Sessions     : list active / revoke
 *   Journal      : list paginated (filtres : userId, action, level, dates)
 */
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService }  from '../../infrastructure/database/prisma.service';
import { RbacService }    from '../../core/iam/services/rbac.service';
import {
  CreateUserDto, UpdateUserDto,
  CreateRoleDto, UpdateRoleDto, SetPermissionsDto,
  AuditQueryDto,
} from './dto/tenant-iam.dto';

@Injectable()
export class TenantIamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac:   RbacService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findRole(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId } });
    if (!role) throw new NotFoundException(`Rôle ${roleId} introuvable`);
    return role;
  }

  private async findUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException(`Utilisateur ${userId} introuvable`);
    return user;
  }

  private async log(opts: {
    tenantId:  string;
    userId?:   string;
    actorId:   string;
    action:    string;
    resource:  string;
    level?:    string;
    newValue?: unknown;
    oldValue?: unknown;
  }) {
    await this.prisma.auditLog.create({
      data: {
        tenantId:  opts.tenantId,
        userId:    opts.actorId,
        plane:     'control',
        level:     opts.level ?? 'info',
        action:    opts.action,
        resource:  opts.resource,
        newValue:  opts.newValue as any ?? undefined,
        oldValue:  opts.oldValue as any ?? undefined,
      },
    });
  }

  // ─── Utilisateurs ──────────────────────────────────────────────────────────

  async listUsers(tenantId: string, search?: string, roleId?: string) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        ...(roleId ? { roleId } : {}),
        ...(search ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' } },
            { name:  { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true, email: true, name: true, userType: true,
        roleId: true, agencyId: true, createdAt: true,
        role:   { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createUser(tenantId: string, dto: CreateUserDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`L'email "${dto.email}" est déjà utilisé`);

    if (dto.roleId) {
      await this.findRole(tenantId, dto.roleId);
    }

    const hash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email:    dto.email,
        name:     dto.name,
        tenantId,
        roleId:   dto.roleId   ?? null,
        agencyId: dto.agencyId ?? null,
        userType: 'STAFF',
      },
      select: {
        id: true, email: true, name: true, userType: true,
        roleId: true, agencyId: true, createdAt: true,
        role:   { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
      },
    });

    await this.prisma.account.create({
      data: {
        userId:     user.id,
        providerId: 'credential',
        accountId:  dto.email,
        password:   hash,
      },
    });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.user.create.tenant',
      resource: `User:${user.id}`,
      newValue: { email: dto.email, name: dto.name },
    });

    return user;
  }

  async getUser(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true, email: true, name: true, userType: true,
        roleId: true, agencyId: true, createdAt: true, updatedAt: true,
        mfaEnabled: true, mfaVerifiedAt: true,
        role:         { select: { id: true, name: true } },
        agency:       { select: { id: true, name: true } },
        staffProfile: {
          select: {
            id: true, status: true,
            assignments: {
              where: { status: 'ACTIVE' },
              select: { id: true, role: true, agencyId: true },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException(`Utilisateur ${userId} introuvable`);

    // Dernière connexion = dernier auth.sign_in.success dans AuditLog.
    // Source unique (pas de duplication dans User.lastLoginAt pour éviter la dérive).
    const lastSignIn = await this.prisma.auditLog.findFirst({
      where:   { tenantId, userId, action: 'auth.sign_in.success' },
      select:  { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return { ...user, lastLoginAt: lastSignIn?.createdAt ?? null };
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateUserDto, actorId: string) {
    await this.findUser(tenantId, userId);

    if (dto.roleId) {
      await this.findRole(tenantId, dto.roleId);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name     !== undefined ? { name:     dto.name     } : {}),
        ...(dto.roleId   !== undefined ? { roleId:   dto.roleId   } : {}),
        ...(dto.agencyId !== undefined ? { agencyId: dto.agencyId } : {}),
      },
      select: {
        id: true, email: true, name: true, userType: true,
        roleId: true, agencyId: true, createdAt: true,
        role:   { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
      },
    });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.user.update.tenant',
      resource: `User:${userId}`,
      newValue: dto,
    });

    return updated;
  }

  async deleteUser(tenantId: string, userId: string, actorId: string) {
    if (userId === actorId) {
      throw new ForbiddenException('Vous ne pouvez pas supprimer votre propre compte');
    }
    const user = await this.findUser(tenantId, userId);

    await this.prisma.user.delete({ where: { id: userId } });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.user.delete.tenant',
      resource: `User:${userId}`,
      level:    'warn',
      oldValue: { email: user.email },
    });
  }

  // ─── Rôles ────────────────────────────────────────────────────────────────

  async listRoles(tenantId: string) {
    return this.prisma.role.findMany({
      where:   { tenantId },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permission: true } },
        _count:      { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createRole(tenantId: string, dto: CreateRoleDto, actorId: string) {
    const existing = await this.prisma.role.findFirst({ where: { tenantId, name: dto.name } });
    if (existing) throw new ConflictException(`Le rôle "${dto.name}" existe déjà`);

    const role = await this.prisma.role.create({
      data: { tenantId, name: dto.name, isSystem: false },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permission: true } },
        _count:      { select: { users: true } },
      },
    });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.role.create.tenant',
      resource: `Role:${role.id}`,
      newValue: { name: dto.name },
    });

    return role;
  }

  async getRole(tenantId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where:  { id: roleId, tenantId },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permission: true } },
        _count:      { select: { users: true } },
      },
    });
    if (!role) throw new NotFoundException(`Rôle ${roleId} introuvable`);
    return role;
  }

  async updateRole(tenantId: string, roleId: string, dto: UpdateRoleDto, actorId: string) {
    const role = await this.findRole(tenantId, roleId);
    if (role.isSystem) {
      throw new ForbiddenException('Les rôles système ne peuvent pas être renommés');
    }

    const updated = await this.prisma.role.update({
      where:  { id: roleId },
      data:   { name: dto.name },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permission: true } },
        _count:      { select: { users: true } },
      },
    });

    await this.rbac.invalidateCache(roleId);
    await this.log({
      tenantId, actorId,
      action:   'control.iam.role.update.tenant',
      resource: `Role:${roleId}`,
      newValue: { name: dto.name },
    });

    return updated;
  }

  async deleteRole(tenantId: string, roleId: string, actorId: string) {
    const role = await this.findRole(tenantId, roleId);
    if (role.isSystem) {
      throw new ForbiddenException('Les rôles système ne peuvent pas être supprimés');
    }

    const usersWithRole = await this.prisma.user.count({ where: { roleId, tenantId } });
    if (usersWithRole > 0) {
      throw new BadRequestException(
        `Ce rôle est assigné à ${usersWithRole} utilisateur(s). Réassignez-les avant de supprimer ce rôle.`,
      );
    }

    await this.prisma.role.delete({ where: { id: roleId } });
    await this.rbac.invalidateCache(roleId);

    await this.log({
      tenantId, actorId,
      action:   'control.iam.role.delete.tenant',
      resource: `Role:${roleId}`,
      level:    'warn',
      oldValue: { name: role.name },
    });
  }

  async setPermissions(tenantId: string, roleId: string, dto: SetPermissionsDto, actorId: string) {
    await this.findRole(tenantId, roleId);

    await this.prisma.$transaction(async (tx) => {
      // Supprimer toutes les permissions existantes
      await (tx as unknown as PrismaService).rolePermission.deleteMany({ where: { roleId } });

      // Recréer avec le nouveau jeu
      if (dto.permissions.length > 0) {
        await (tx as unknown as PrismaService).rolePermission.createMany({
          data: dto.permissions.map(permission => ({ roleId, permission })),
          skipDuplicates: true,
        });
      }
    });

    await this.rbac.invalidateCache(roleId);

    await this.log({
      tenantId, actorId,
      action:   'control.iam.role.permissions.update.tenant',
      resource: `Role:${roleId}`,
      level:    'info',
      newValue: { count: dto.permissions.length },
    });

    return this.getRole(tenantId, roleId);
  }

  // ─── Sessions ─────────────────────────────────────────────────────────────

  async listSessions(tenantId: string) {
    return this.prisma.session.findMany({
      where:   { tenantId, expiresAt: { gt: new Date() } },
      select: {
        id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Révoque TOUTES les sessions actives d'un user. À utiliser après changement
   * critique (rôle, suspension, suspicion de compromission). Le user devra se
   * reconnecter pour obtenir un nouveau cookie de session avec les perms à jour.
   */
  async revokeUserSessions(tenantId: string, userId: string, actorId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new NotFoundException(`User ${userId} introuvable dans ce tenant`);

    const res = await this.prisma.session.deleteMany({ where: { userId, tenantId } });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.session.revoke.tenant',
      resource: `User:${userId}`,
      level:    'warn',
      newValue: { revokedCount: res.count },
    });

    return { revokedCount: res.count };
  }

  async revokeSession(tenantId: string, sessionId: string, actorId: string) {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException(`Session ${sessionId} introuvable`);

    await this.prisma.session.delete({ where: { id: sessionId } });

    await this.log({
      tenantId, actorId,
      action:   'control.iam.session.revoke.tenant',
      resource: `Session:${sessionId}`,
      level:    'warn',
      oldValue: { userId: session.userId },
    });
  }

  // ─── Journal d'accès ──────────────────────────────────────────────────────

  async listAuditLogs(tenantId: string, query: AuditQueryDto) {
    const page  = Math.max(1, parseInt(query.page  ?? '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (query.userId) where['userId']   = query.userId;
    if (query.level)  where['level']    = query.level;
    if (query.action) where['action']   = { contains: query.action, mode: 'insensitive' };

    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter['gte'] = new Date(query.from);
      if (query.to)   dateFilter['lte'] = new Date(query.to);
      where['createdAt'] = dateFilter;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where:   where as any,
        select: {
          id: true, createdAt: true, plane: true, level: true,
          action: true, resource: true, ipAddress: true,
          securityLevel: true, newValue: true,
          userId: true,
          user: { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where: where as any }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── Détail utilisateur : sessions + historique ──────────────────────────

  /** Sessions actives pour UN user (onglet Sécurité de la modale détail). */
  async listUserSessions(tenantId: string, userId: string) {
    await this.findUser(tenantId, userId);
    return this.prisma.session.findMany({
      where:  { tenantId, userId, expiresAt: { gt: new Date() } },
      select: {
        id: true, ipAddress: true, userAgent: true,
        createdAt: true, expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Historique des tentatives de connexion (succès + échec) d'un user.
   * Source : AuditLog où action ∈ {auth.sign_in.success, auth.sign_in.failure}.
   * `userAgent` est stocké dans newValue.userAgent (voir AuthService.auditSignIn).
   */
  async getUserLoginHistory(tenantId: string, userId: string, limit = 50) {
    await this.findUser(tenantId, userId);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId, userId,
        action: { in: ['auth.sign_in.success', 'auth.sign_in.failure'] },
      },
      select: {
        id: true, createdAt: true, action: true,
        ipAddress: true, newValue: true,
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(200, Math.max(1, limit)),
    });

    return rows.map(r => ({
      id:         r.id,
      at:         r.createdAt,
      success:    r.action === 'auth.sign_in.success',
      ipAddress:  r.ipAddress,
      userAgent:  (r.newValue as { userAgent?: string } | null)?.userAgent ?? null,
    }));
  }
}
