import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/eventbus/redis-publisher.service';
import { Permission } from '../../../common/constants/permissions';

@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Vérifie une permission en DB (sans cache — pour les appels admin critiques). */
  async hasPermission(roleId: string, permission: Permission): Promise<boolean> {
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId, permission },
    });
    return rp !== null;
  }

  /** Retourne toutes les permissions d'un rôle depuis la DB. */
  async getPermissions(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where: { roleId },
      select: { permission: true },
    });
    return rows.map(r => r.permission);
  }

  /**
   * Invalide le cache Redis pour toutes les permissions d'un rôle.
   * Appelé après control.iam.manage.tenant (ajout/suppression de permission).
   */
  async invalidateCache(roleId: string): Promise<void> {
    // Pattern delete — ioredis ne supporte pas SCAN pattern natif, on utilise keys()
    // en dev/staging. En prod avec Redis Cluster, préférer un tag-based approach.
    const keys = await this.redis.keys(`iam:perm:${roleId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /** Check si un user peut agir dans une agence donnée (scope agency). */
  async canActInAgency(
    userAgencyId: string | undefined,
    resourceAgencyId: string | undefined,
    roleId: string,
  ): Promise<boolean> {
    // Roles avec permissions *.tenant ou *.global peuvent agir cross-agency
    const permissions = await this.getPermissions(roleId);
    const hasTenantOrGlobal = permissions.some(
      p => p.endsWith('.tenant') || p.endsWith('.global'),
    );
    if (hasTenantOrGlobal) return true;
    if (!userAgencyId || !resourceAgencyId) return false;
    return userAgencyId === resourceAgencyId;
  }
}
