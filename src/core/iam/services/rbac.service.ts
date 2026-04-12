import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../infrastructure/eventbus/redis-publisher.service';
import { Permission } from '../../../common/constants/permissions';

/**
 * Cache key strategy :
 *   Permission granted/denied → iam:perm:{roleId}:{permission}  TTL 60s
 *   Role permission index     → iam:role-perms:{roleId}  (Redis Set)   TTL 300s
 *
 * Invalidation via SCAN (jamais KEYS — O(N) bloquant sur Redis Cluster).
 */
@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async hasPermission(roleId: string, permission: Permission): Promise<boolean> {
    const rp = await this.prisma.rolePermission.findFirst({
      where: { roleId, permission },
    });
    return rp !== null;
  }

  async getPermissions(roleId: string): Promise<string[]> {
    const rows = await this.prisma.rolePermission.findMany({
      where:  { roleId },
      select: { permission: true },
    });
    return rows.map(r => r.permission);
  }

  /**
   * Invalide le cache pour toutes les permissions d'un rôle.
   * SCAN cursor-based — non-bloquant, compatible Redis Cluster (single-shard pattern).
   * Chaque appel traite max 200 clés par itération pour limiter la pression.
   */
  async invalidateCache(roleId: string): Promise<void> {
    const pattern = `iam:perm:${roleId}:*`;
    let cursor = '0';

    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...(keys as [string, ...string[]]));
      }
    } while (cursor !== '0');

    // Invalider aussi le Set d'index si présent
    await this.redis.del(`iam:role-perms:${roleId}`);
  }

  /**
   * Vérifie si un acteur peut agir dans une agence donnée.
   * Une permission *.tenant ou *.global autorise le cross-agency.
   */
  async canActInAgency(
    userAgencyId:     string | undefined,
    resourceAgencyId: string | undefined,
    roleId:           string,
  ): Promise<boolean> {
    const permissions    = await this.getPermissions(roleId);
    const hasBroadScope  = permissions.some(p => p.endsWith('.tenant') || p.endsWith('.global'));
    if (hasBroadScope) return true;
    if (!userAgencyId || !resourceAgencyId) return false;
    return userAgencyId === resourceAgencyId;
  }
}
