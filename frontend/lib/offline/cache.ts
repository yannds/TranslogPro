/**
 * Offline read-through cache — règle simple :
 *   1. Toujours essayer le réseau d'abord.
 *   2. En cas de succès → mettre à jour l'IDB + retourner le payload.
 *   3. En cas d'échec (offline/5xx) → retomber sur l'IDB.
 *   4. Si rien en cache → propager l'erreur.
 *
 * Le caller passe sa propre fn `toCached(payload) → CachedX[]` et sa propre
 * clé de cache. On reste générique pour fonctionner avec trips, manifests,
 * invoices, passengers.
 */

import { offlineDB } from './db';
import { apiFetch, ApiError } from '../api';

export interface CacheRecord {
  id:        string;
  tenantId:  string;
  data:      unknown;
  updatedAt: number;
  tripId?:   string | null;
}

export type CacheTable = 'trips' | 'passengers' | 'parcels' | 'manifests' | 'invoices';

/**
 * Lit une liste depuis le réseau, la met en cache par élément, et retourne
 * la liste (réseau si disponible, sinon cache filtré par `cachedFilter`).
 */
export async function cachedListFetch<T>(
  table: CacheTable,
  url: string,
  opts: {
    tenantId:       string;
    toRecord:       (item: T) => { id: string; tripId?: string | null };
    cachedFilter?:  (row: CacheRecord) => boolean;
  },
): Promise<{ items: T[]; fromCache: boolean }> {
  try {
    const items = await apiFetch<T[]>(url, { skipRedirectOn401: true });
    // Upsert en cache
    const now = Date.now();
    await offlineDB.transaction('rw', offlineDB[table] as any, async () => {
      await (offlineDB[table] as any).bulkPut(
        items.map(it => {
          const r = opts.toRecord(it);
          return {
            id:        r.id,
            tenantId:  opts.tenantId,
            tripId:    r.tripId ?? null,
            data:      it,
            updatedAt: now,
          } as CacheRecord;
        }),
      );
    });
    return { items, fromCache: false };
  } catch (err) {
    // Toute erreur réseau (TypeError) ou 5xx → fallback cache
    const offline = err instanceof TypeError || (err instanceof ApiError && err.status >= 500);
    if (!offline) throw err;
    const rows = await (offlineDB[table] as any).where('tenantId').equals(opts.tenantId).toArray() as CacheRecord[];
    const filtered = opts.cachedFilter ? rows.filter(opts.cachedFilter) : rows;
    return { items: filtered.map(r => r.data as T), fromCache: true };
  }
}

/** Version "détail" (un seul enregistrement par id). */
export async function cachedItemFetch<T>(
  table: CacheTable,
  id:    string,
  url:   string,
  opts: {
    tenantId: string;
    toRecord?: (item: T) => { tripId?: string | null };
  },
): Promise<{ item: T; fromCache: boolean }> {
  try {
    const item = await apiFetch<T>(url, { skipRedirectOn401: true });
    const tripId = opts.toRecord ? opts.toRecord(item).tripId ?? null : null;
    await (offlineDB[table] as any).put({
      id,
      tenantId:  opts.tenantId,
      tripId,
      data:      item,
      updatedAt: Date.now(),
    } as CacheRecord);
    return { item, fromCache: false };
  } catch (err) {
    const offline = err instanceof TypeError || (err instanceof ApiError && err.status >= 500);
    if (!offline) throw err;
    const row = await (offlineDB[table] as any).get(id) as CacheRecord | undefined;
    if (!row) throw err;
    return { item: row.data as T, fromCache: true };
  }
}

/** Lit directement depuis l'IDB (pour afficher un snapshot même sans fetch). */
export async function readCached<T>(table: CacheTable, tenantId: string): Promise<T[]> {
  const rows = await (offlineDB[table] as any).where('tenantId').equals(tenantId).toArray() as CacheRecord[];
  return rows.map(r => r.data as T);
}
