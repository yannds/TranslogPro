/**
 * TenancyModule — Module NestJS d'infrastructure multi-tenant.
 *
 * EXPORTE (utilisables partout sans import circulaire) :
 *   - HostConfigService        : config centralisée domaines/sous-domaines
 *   - TenantResolverService    : host → tenant (seed + custom domains Phase 3)
 *   - TenantDomainRepository   : accès cache-aware à tenant_domains
 *   - TenantHostMiddleware     : injection req.resolvedHostTenant
 *   - TenantIsolationGuard     : 403 sur mismatch session vs host
 *
 * FOURNIT aussi les helpers purs :
 *   - getCurrentTenantId(req)  : lecture abstraite (voir current-tenant.ts)
 *   - PLATFORM_TENANT_ID       : UUID du tenant plateforme
 *
 * @Global : les services sont injectables depuis n'importe quel module sans
 * besoin d'importer TenancyModule à chaque fois. C'est justifié pour une
 * infrastructure transverse — au même titre que PrismaService ou Logger.
 */

import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { HostConfigService } from './host-config.service';
import { TenantDomainRepository } from './tenant-domain.repository';
import { TenantResolverService } from './tenant-resolver.service';
import { TenantHostMiddleware } from './tenant-host.middleware';
import { TenantIsolationGuard } from './tenant-isolation.guard';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    HostConfigService,
    TenantDomainRepository,
    TenantResolverService,
    TenantHostMiddleware,
    TenantIsolationGuard,
  ],
  exports: [
    HostConfigService,
    TenantDomainRepository,
    TenantResolverService,
    TenantHostMiddleware,
    TenantIsolationGuard,
  ],
})
export class TenancyModule {}
