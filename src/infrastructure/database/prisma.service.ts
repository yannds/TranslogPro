import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
    private readonly tenantContext: TenantContextService,
  ) {
    super({
      log: process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }]
        : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit() {
    const dbUrl = await this.secretService.getSecret('platform/db', 'DATABASE_URL');
    // Réinitialiser la connexion avec l'URL obtenue de Vault
    (this as any)._engineConfig.url = dbUrl;

    await this.$connect();
    this.logger.log('✅ Database connected');

    // Extension Prisma pour injecter SET LOCAL app.tenant_id automatiquement
    this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query, model, operation }) {
            const ctx = TenantContextService.getStore();
            if (!ctx?.tenantId) return query(args);

            // Wrapper dans une transaction pour SET LOCAL
            return (this as any).$transaction(async (tx: PrismaClient) => {
              await tx.$executeRaw`SET LOCAL app.tenant_id = ${ctx.tenantId}`;
              return query(args);
            });
          },
        },
      },
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Exécute une transaction avec SET LOCAL tenant_id */
  async withTenant<T>(tenantId: string, fn: (tx: PrismaService) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL app.tenant_id = ${tenantId}`;
      return fn(tx as unknown as PrismaService);
    });
  }

  /** Transaction standard avec contexte tenant injecté automatiquement */
  async transact<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    const ctx = TenantContextService.getStore();
    return this.$transaction(async (tx) => {
      if (ctx?.tenantId) {
        await tx.$executeRaw`SET LOCAL app.tenant_id = ${ctx.tenantId}`;
      }
      return fn(tx);
    });
  }
}
