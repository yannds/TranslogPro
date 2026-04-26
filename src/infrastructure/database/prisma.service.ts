import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';
import { TenantContextService } from './tenant-context.service';
import { TenantTxStorage } from './tenant-tx.storage';

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

/**
 * Construit dynamiquement la liste des modèles Prisma porteurs d'un champ
 * `tenantId`. Sert de filtre pour le middleware d'isolation tenant.
 */
function buildTenantScopedModels(): Set<string> {
  const set = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (model.fields.some((f) => f.name === 'tenantId')) {
      set.add(model.name);
    }
  }
  return set;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly tenantScopedModels = buildTenantScopedModels();

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

    if (process.env.TENANT_ISOLATION_MIDDLEWARE === 'off') {
      this.logger.warn(
        '⚠️  Tenant isolation middleware DESACTIVE via TENANT_ISOLATION_MIDDLEWARE=off (kill-switch)',
      );
      return;
    }

    this.installTenantIsolationMiddleware();
    this.logger.log(
      `🔒 Tenant isolation middleware actif (${this.tenantScopedModels.size} modèles tenant-scoped)`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Middleware d'isolation tenant — couche défense applicative.
   *
   * Pour chaque opération sur un modèle porteur d'un champ `tenantId` :
   *  - lit le contexte tenant courant (AsyncLocalStorage via RlsMiddleware HTTP)
   *  - injecte `where.tenantId` (find/update/delete) ou `data.tenantId` (create)
   *    si le developpeur ne l'a pas déjà précisé
   *
   * Comportement explicit-override-friendly :
   *  - Si pas de contexte tenant → pass-through (queries platform/health/signup)
   *  - Si `where.tenantId` déjà fourni → respect du choix dev (cross-tenant admin)
   *
   * Cette couche complète (sans remplacer) la RLS Postgres et empêche les fuites
   * accidentelles cross-tenant lorsqu'un développeur oublie le filtre tenant.
   */
  private installTenantIsolationMiddleware() {
    this.$use(async (params, next) => {
      const model = params.model;
      if (!model || !this.tenantScopedModels.has(model)) {
        return next(params);
      }

      const ctx = TenantContextService.getStore();
      if (!ctx?.tenantId) {
        return next(params);
      }
      const tenantId = ctx.tenantId;

      switch (params.action) {
        case 'findUnique':
        case 'findUniqueOrThrow':
        case 'findFirst':
        case 'findFirstOrThrow':
        case 'findMany':
        case 'count':
        case 'aggregate':
        case 'groupBy':
        case 'update':
        case 'updateMany':
        case 'delete':
        case 'deleteMany': {
          params.args = params.args || {};
          const where = params.args.where || {};
          if (where.tenantId === undefined) {
            params.args.where = { ...where, tenantId };
          }
          break;
        }

        case 'create': {
          params.args = params.args || {};
          const data = params.args.data || {};
          if (data.tenantId === undefined) {
            params.args.data = { ...data, tenantId };
          }
          break;
        }

        case 'createMany': {
          params.args = params.args || {};
          const data = params.args.data;
          if (Array.isArray(data)) {
            params.args.data = data.map((item: any) =>
              item && item.tenantId === undefined ? { ...item, tenantId } : item,
            );
          } else if (data && data.tenantId === undefined) {
            params.args.data = { ...data, tenantId };
          }
          break;
        }

        case 'upsert': {
          params.args = params.args || {};
          const where = params.args.where || {};
          const create = params.args.create || {};
          if (where.tenantId === undefined) {
            params.args.where = { ...where, tenantId };
          }
          if (create.tenantId === undefined) {
            params.args.create = { ...create, tenantId };
          }
          break;
        }

        default:
          break;
      }

      return next(params);
    });
  }

  /** Exécute une transaction avec SET LOCAL tenant_id */
  async withTenant<T>(tenantId: string, fn: (tx: PrismaService) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await setTenantLocal(tx, tenantId);
      return fn(tx as unknown as PrismaService);
    });
  }

  /**
   * Ouvre la transaction request-scoped + set_config + invoque fn dans le scope
   * AsyncLocalStorage. Utilise par TenantTxInterceptor pour wrapper chaque
   * requete HTTP authentifiee. La transaction commit a la fin de fn (ou rollback
   * si erreur). Pendant l'execution, tout `prismaProxy.<model>.<op>()` est
   * automatiquement route via tx (cf. wrapPrismaServiceWithTxProxy).
   */
  async runInTenantTx<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await setTenantLocal(tx, tenantId);
      return TenantTxStorage.run(tx, fn);
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

/**
 * Wrappe l'instance PrismaService dans un Proxy qui route les acces aux
 * accesseurs de modele (`.user`, `.ticket`, …) vers la transaction
 * request-scoped quand le `TenantTxInterceptor` en a ouvert une.
 *
 * Les methodes infrastructurelles (commencant par `$` ou champs internes)
 * sont toujours servies par l'instance reelle (ex: `$transaction`, `$connect`,
 * `withTenant`, `runInTenantTx`).
 *
 * Activable via env `TENANT_DB_LEVEL_RLS=on` (OFF par defaut le temps d'auditer
 * les paths fire-and-forget post-handler qui pourraient referencer une tx morte).
 */
export function wrapPrismaServiceWithTxProxy(real: PrismaService): PrismaService {
  if (process.env.TENANT_DB_LEVEL_RLS !== 'on') {
    return real;
  }

  return new Proxy(real, {
    get(target, prop, receiver) {
      // Methodes Prisma client / fields internes : toujours sur l'instance reelle
      if (
        typeof prop !== 'string' ||
        prop.startsWith('$') ||
        prop.startsWith('_') ||
        prop in PrismaService.prototype ||
        !(prop in target)
      ) {
        return Reflect.get(target, prop, receiver);
      }

      // Acces a un modele : route via tx si presente
      const tx = TenantTxStorage.getStore();
      if (tx && prop in tx) {
        return Reflect.get(tx, prop, tx);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaService;
}
