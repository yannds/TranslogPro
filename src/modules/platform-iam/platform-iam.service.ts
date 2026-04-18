/**
 * PlatformIamService — IAM cross-tenant réservé au staff plateforme.
 *
 * Contrairement à TenantIamService qui filtre `where: { tenantId }`, ce service
 * requête l'ensemble des rows AuditLog / Session / User et peut optionnellement
 * restreindre par `tenantId` via un filtre serveur.
 *
 * Invariants :
 *   • L'appelant est garanti staff plateforme (tenantId = PLATFORM_TENANT_ID)
 *     grâce au PermissionGuard + permissions *.global.
 *   • Toute action mutante (revoke session, reset MFA) est loggée dans AuditLog
 *     avec tenantId = PLATFORM_TENANT_ID (critique pour ISO 27001).
 */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService }      from '../../infrastructure/database/prisma.service';
import { PLATFORM_TENANT_ID } from '../../../prisma/seeds/iam.seed';
import {
  PlatformAuditQueryDto,
  PlatformUsersQueryDto,
  PlatformSessionsQueryDto,
} from './dto/platform-iam.dto';

@Injectable()
export class PlatformIamService {
  private readonly logger = new Logger(PlatformIamService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers audit ──────────────────────────────────────────────────────────

  private async log(opts: {
    actorId:   string;
    action:    string;
    resource:  string;
    level?:    string;
    targetTenantId?: string | null;
    newValue?: unknown;
    oldValue?: unknown;
  }) {
    await this.prisma.auditLog.create({
      data: {
        // Audit écrit sur le tenant plateforme — l'action est globale.
        tenantId:  PLATFORM_TENANT_ID,
        userId:    opts.actorId,
        plane:     'control',
        level:     opts.level ?? 'info',
        action:    opts.action,
        resource:  opts.resource,
        newValue:  (opts.newValue as any) ?? (opts.targetTenantId ? { targetTenantId: opts.targetTenantId } : undefined),
        oldValue:  (opts.oldValue as any) ?? undefined,
      },
    });
  }

  // ─── Audit cross-tenant ─────────────────────────────────────────────────────

  /**
   * Liste paginée du journal d'accès, sans filtre tenant par défaut.
   * Inclut la relation tenant (nom/slug) pour l'affichage et l'actor (user).
   */
  async listAuditLogs(query: PlatformAuditQueryDto) {
    const page  = Math.max(1, query.page  ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.tenantId) where['tenantId'] = query.tenantId;
    if (query.userId)   where['userId']   = query.userId;
    if (query.level)    where['level']    = query.level;
    if (query.action)   where['action']   = { contains: query.action, mode: 'insensitive' };
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) dateFilter['gte'] = new Date(query.from);
      if (query.to)   dateFilter['lte'] = new Date(query.to);
      where['createdAt'] = dateFilter;
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where:  where as any,
        select: {
          id: true, createdAt: true, plane: true, level: true,
          action: true, resource: true, ipAddress: true,
          securityLevel: true, newValue: true,
          userId: true, tenantId: true,
          user:   { select: { email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where: where as any }),
    ]);

    // Résolution tenantId → name/slug en une requête (AuditLog n'a pas de FK).
    const tenantIds = Array.from(new Set(items.map(i => i.tenantId)));
    const tenants = tenantIds.length > 0
      ? await this.prisma.tenant.findMany({
          where:  { id: { in: tenantIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const tenantMap = new Map(tenants.map(t => [t.id, t]));

    const enriched = items.map(i => ({
      ...i,
      tenant: tenantMap.get(i.tenantId) ?? null,
    }));

    return { items: enriched, total, page, limit, pages: Math.ceil(total / limit) };
  }

  // ─── Sessions cross-tenant ──────────────────────────────────────────────────

  async listSessions(query: PlatformSessionsQueryDto) {
    const where: Record<string, unknown> = { expiresAt: { gt: new Date() } };
    if (query.tenantId) where['tenantId'] = query.tenantId;
    if (query.userId)   where['userId']   = query.userId;

    const sessions = await this.prisma.session.findMany({
      where:  where as any,
      select: {
        id: true, ipAddress: true, userAgent: true,
        createdAt: true, expiresAt: true,
        tenantId: true,
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:    500,
    });

    const tenantIds = Array.from(new Set(sessions.map(s => s.tenantId)));
    const tenants = tenantIds.length > 0
      ? await this.prisma.tenant.findMany({
          where:  { id: { in: tenantIds } },
          select: { id: true, name: true, slug: true },
        })
      : [];
    const tenantMap = new Map(tenants.map(t => [t.id, t]));

    return sessions.map(s => ({ ...s, tenant: tenantMap.get(s.tenantId) ?? null }));
  }

  async revokeSession(sessionId: string, actorId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException(`Session ${sessionId} introuvable`);

    await this.prisma.session.delete({ where: { id: sessionId } });

    await this.log({
      actorId,
      action:   'control.platform.session.revoke.global',
      resource: `Session:${sessionId}`,
      level:    'warn',
      targetTenantId: session.tenantId,
      oldValue: { userId: session.userId, tenantId: session.tenantId },
    });

    return { revoked: true, sessionId };
  }

  // ─── Users cross-tenant ─────────────────────────────────────────────────────

  async listUsers(query: PlatformUsersQueryDto) {
    const where: Record<string, unknown> = {};
    if (query.tenantId) where['tenantId'] = query.tenantId;
    if (query.userType) where['userType'] = query.userType;
    if (query.search) {
      where['OR'] = [
        { email: { contains: query.search, mode: 'insensitive' } },
        { name:  { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.user.findMany({
      where:  where as any,
      select: {
        id: true, email: true, name: true, userType: true,
        isActive: true, mfaEnabled: true,
        createdAt: true, tenantId: true,
        role:   { select: { id: true, name: true } },
        tenant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:    500,
    });

    return users;
  }

  /**
   * Reset MFA pour un user — supprime les secrets TOTP + désactive mfaEnabled.
   * L'utilisateur devra reconfigurer un nouveau TOTP à son prochain login.
   * Escalade uniquement (SUPER_ADMIN ou SUPPORT_L2).
   */
  async resetMfa(userId: string, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, email: true, tenantId: true, mfaEnabled: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} introuvable`);

    // Garde-fou : on ne peut pas reset le MFA d'un SA plateforme autre que soi
    // (ce serait une élévation de privilèges). Un SA doit reset son propre
    // MFA via le flux standard /settings/security ou via un autre SA explicitement.
    if (user.tenantId === PLATFORM_TENANT_ID && user.id !== actorId) {
      const target = await this.prisma.user.findUnique({
        where:  { id: userId },
        select: { role: { select: { name: true } } },
      });
      if (target?.role?.name === 'SUPER_ADMIN') {
        throw new ForbiddenException(
          'Le reset MFA d\'un SUPER_ADMIN plateforme n\'est pas autorisé via cette route.',
        );
      }
    }

    // Les secrets TOTP sont portés directement par User.mfaSecret + mfaBackupCodes
    // (pas de table dédiée). Un reset remet à zéro tous les champs MFA : le user
    // devra re-scanner un QR à la prochaine connexion si le tenant l'exige.
    await this.prisma.user.update({
      where: { id: userId },
      data:  {
        mfaEnabled:     false,
        mfaVerifiedAt:  null,
        mfaSecret:      null,
        mfaBackupCodes: [],
      },
    });

    await this.log({
      actorId,
      action:   'control.platform.mfa.reset.global',
      resource: `User:${userId}`,
      level:    'warn',
      targetTenantId: user.tenantId,
      oldValue: { mfaWasEnabled: user.mfaEnabled, email: user.email },
    });

    return { reset: true, userId };
  }

  // ─── Roles — vue read-only des 3 rôles plateforme ──────────────────────────

  async listPlatformRoles() {
    return this.prisma.role.findMany({
      where:   { tenantId: PLATFORM_TENANT_ID },
      select: {
        id: true, name: true, isSystem: true,
        permissions: { select: { permission: true } },
        _count:      { select: { users: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
