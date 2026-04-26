import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService, wrapPrismaServiceWithTxProxy } from './prisma.service';
import { TenantContextService } from './tenant-context.service';
import { TenantTxInterceptor } from './tenant-tx.interceptor';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

/**
 * Provider PrismaService :
 *  - en mode RLS DB-level (`TENANT_DB_LEVEL_RLS=on`) → instance reelle wrappee
 *    dans un Proxy qui route les modeles vers la transaction request-scoped
 *  - sinon → instance reelle (proxy bypassed via env check dans le wrap helper)
 *
 * L'interceptor `TenantTxInterceptor` est enregistre globalement et sera
 * inerte tant que `TENANT_DB_LEVEL_RLS !== 'on'`.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    {
      provide: PrismaService,
      useFactory: (secretService: ISecretService, tenantContext: TenantContextService) => {
        const real = new PrismaService(secretService, tenantContext);
        return wrapPrismaServiceWithTxProxy(real);
      },
      inject: [SECRET_SERVICE, TenantContextService],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantTxInterceptor,
    },
  ],
  exports: [PrismaService, TenantContextService],
})
export class DatabaseModule {}
