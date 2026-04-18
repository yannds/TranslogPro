/**
 * Barrel export — Tenancy module public API.
 *
 * Règle : tout import depuis l'extérieur doit passer par `core/tenancy`,
 * jamais par les fichiers internes. Cela garantit qu'un futur déplacement
 * (ex: extraction en package npm) ne casse aucun appelant.
 */

export { HostConfigService, type IHostConfig } from './host-config.service';
export {
  TenantResolverService,
  PLATFORM_TENANT_ID,
  type ITenantResolver,
} from './tenant-resolver.service';
export {
  TenantDomainRepository,
  type TenantDomainWithTenant,
} from './tenant-domain.repository';
export { TenantHostMiddleware } from './tenant-host.middleware';
export { TenantIsolationGuard } from './tenant-isolation.guard';
export { PathTenantMatchGuard } from './path-tenant-match.guard';
export { TenancyModule } from './tenancy.module';
export {
  getCurrentTenantId,
  requireCurrentTenantId,
  getCurrentTenantSource,
  type ResolvedTenant,
  type TenantSource,
  type ImpersonationContextShape,
  type SessionUserShape,
} from './current-tenant';
