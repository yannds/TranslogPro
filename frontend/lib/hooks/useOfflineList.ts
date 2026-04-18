/**
 * useOfflineList — Hook drop-in pour des listes read-through cache.
 *
 * Semblable à `useFetch` mais :
 *   - met en cache IDB à chaque succès réseau,
 *   - sert le cache en cas d'offline (et flag `fromCache` en retour),
 *   - expose `refetch` pour retenter à la demande.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cachedListFetch, type CacheTable } from '../offline/cache';

export interface UseOfflineListOptions<T> {
  table:         CacheTable;
  tenantId:      string;
  url:           string | null;
  toRecord:      (item: T) => { id: string; tripId?: string | null };
  cachedFilter?: (row: { id: string; tripId?: string | null; data: unknown; updatedAt: number }) => boolean;
  /** deps supplémentaires : si une des valeurs change → refetch (comme useEffect). */
  deps?:         unknown[];
}

export interface UseOfflineListResult<T> {
  items:     T[];
  loading:   boolean;
  error:     string | null;
  fromCache: boolean;
  refetch:   () => void;
}

export function useOfflineList<T>(opts: UseOfflineListOptions<T>): UseOfflineListResult<T> {
  const { table, tenantId, url, toRecord, cachedFilter, deps = [] } = opts;
  const [items,     setItems]     = useState<T[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const versionRef = useRef(0);
  const toRecordRef = useRef(toRecord);
  toRecordRef.current = toRecord;
  const cachedFilterRef = useRef(cachedFilter);
  cachedFilterRef.current = cachedFilter;

  const run = useCallback(async () => {
    if (!url || !tenantId) return;
    const v = ++versionRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await cachedListFetch<T>(table, url, {
        tenantId,
        toRecord:     toRecordRef.current,
        cachedFilter: cachedFilterRef.current as any,
      });
      if (v !== versionRef.current) return;
      setItems(res.items);
      setFromCache(res.fromCache);
    } catch (err) {
      if (v !== versionRef.current) return;
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      if (v === versionRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tenantId, url, ...deps]);

  useEffect(() => { run(); }, [run]);

  return { items, loading, error, fromCache, refetch: run };
}
