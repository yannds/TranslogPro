import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';

/**
 * Storage AsyncLocalStorage pour la transaction Prisma request-scoped.
 *
 * Le `TenantTxInterceptor` peuple ce storage au debut de chaque requete HTTP
 * authentifiee, avec une transaction dans laquelle `set_config('app.tenant_id', X)`
 * a ete appele. Le `PrismaService` (proxy) lit ce storage et route les
 * operations sur les modeles vers la transaction si presente.
 *
 * Permet d'activer une RLS Postgres en mode RESTRICTIVE : chaque connexion
 * exposee a `app_runtime` a son `app.tenant_id` defini, donc les policies
 * RESTRICTIVE peuvent exiger un match strict sans casser le code existant.
 */
const storage = new AsyncLocalStorage<Prisma.TransactionClient>();

export const TenantTxStorage = {
  run<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T> {
    return storage.run(tx, fn);
  },

  getStore(): Prisma.TransactionClient | undefined {
    return storage.getStore();
  },
};
