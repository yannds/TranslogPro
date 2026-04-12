import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string;
  userId?: string;
  agencyId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

@Injectable()
export class TenantContextService {
  /** Exécute une fonction dans un contexte tenant isolé */
  static run<T>(store: TenantStore, fn: () => T): T {
    return storage.run(store, fn) as T;
  }

  /** Récupère le contexte tenant du thread courant */
  static getStore(): TenantStore | undefined {
    return storage.getStore();
  }

  /** Récupère le tenantId ou lève une erreur */
  static requireTenantId(): string {
    const store = storage.getStore();
    if (!store?.tenantId) throw new Error('No tenant context — missing RLS setup');
    return store.tenantId;
  }
}
