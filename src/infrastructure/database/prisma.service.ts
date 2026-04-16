import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';
import { TenantContextService } from './tenant-context.service';

/**
 * Injecte app.tenant_id dans la session PostgreSQL (scope transaction).
 *
 * Utilise `set_config('app.tenant_id', $1, true)` au lieu de `SET LOCAL`
 * car SET LOCAL ne supporte pas les paramètres positionnels ($1) en PostgreSQL,
 * tandis que set_config() est une fonction SQL standard qui les accepte.
 * Le 3ᵉ argument `true` = LOCAL (scoped à la transaction en cours).
 */
function setTenantLocal(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}

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

    // Extension Prisma pour injecter app.tenant_id automatiquement
    this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const ctx = TenantContextService.getStore();
            if (!ctx?.tenantId) return query(args);

            return (this as any).$transaction(async (tx: Prisma.TransactionClient) => {
              await setTenantLocal(tx, ctx.tenantId);
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
      await setTenantLocal(tx, tenantId);
      return fn(tx as unknown as PrismaService);
    });
  }

  /** Transaction standard avec contexte tenant injecté automatiquement */
  async transact<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const ctx = TenantContextService.getStore();
    return this.$transaction(async (tx) => {
      if (ctx?.tenantId) {
        await setTenantLocal(tx, ctx.tenantId);
      }
      return fn(tx);
    });
  }
}
