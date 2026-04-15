import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';

export interface TenantModuleDto {
  moduleKey: string;
  isActive:  boolean;
  config:    Record<string, unknown>;
}

/**
 * TenantModuleService — CRUD métier pour `installed_modules`.
 *
 * Source de vérité pour l'activation/désactivation des modules SaaS d'un tenant.
 * Le ModuleGuard s'appuie sur cette même table (via Redis cache TTL 300s).
 * Toute écriture invalide le cache Redis `module:{tenantId}:{moduleKey}`.
 */
@Injectable()
export class TenantModuleService {
  private readonly logger = new Logger(TenantModuleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liste des modules installés (actifs et inactifs) pour un tenant. */
  async listForTenant(tenantId: string): Promise<TenantModuleDto[]> {
    const rows = await this.prisma.installedModule.findMany({
      where:  { tenantId },
      select: { moduleKey: true, isActive: true, config: true },
    });
    return rows.map(r => ({
      moduleKey: r.moduleKey,
      isActive:  r.isActive,
      config:    (r.config ?? {}) as Record<string, unknown>,
    }));
  }

  /** Liste des `moduleKey` actifs pour un tenant (optimisé pour l'auth). */
  async listActiveKeys(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.installedModule.findMany({
      where:  { tenantId, isActive: true },
      select: { moduleKey: true },
    });
    return rows.map(r => r.moduleKey);
  }

  /**
   * Active ou désactive un module pour un tenant.
   * Crée la ligne si elle n'existe pas (upsert).
   * Invalide le cache Redis du ModuleGuard.
   */
  async setActive(tenantId: string, moduleKey: string, isActive: boolean): Promise<TenantModuleDto> {
    const row = await this.prisma.installedModule.upsert({
      where:  { tenantId_moduleKey: { tenantId, moduleKey } },
      update: { isActive },
      create: { tenantId, moduleKey, isActive },
      select: { moduleKey: true, isActive: true, config: true },
    });

    await this.invalidateCache(tenantId, moduleKey);
    this.logger.log(`[MODULES] tenant=${tenantId} key=${moduleKey} isActive=${isActive}`);

    return {
      moduleKey: row.moduleKey,
      isActive:  row.isActive,
      config:    (row.config ?? {}) as Record<string, unknown>,
    };
  }

  private async invalidateCache(tenantId: string, moduleKey: string): Promise<void> {
    try {
      await this.redis.del(`module:${tenantId}:${moduleKey}`);
    } catch (err) {
      this.logger.warn(`[MODULES] cache invalidation failed: ${String(err)}`);
    }
  }
}
