/**
 * useFetch<T> — Hook générique de chargement de données
 *
 * Utilise apiFetch (credentials: 'include') avec gestion d'état locale.
 *
 * Usage :
 *   const { data, loading, error, refetch } = useFetch<BusDto[]>(
 *     `/api/tenants/${tenantId}/fleet/buses`,
 *     [tenantId],
 *   );
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, type ApiFetchOptions } from '../api';

export interface UseFetchResult<T> {
  data:    T | null;
  loading: boolean;
  error:   string | null;
  refetch: () => void;
}

/**
 * @param url  - Chemin API (ex: `/api/tenants/xxx/fleet/buses`)
 * @param deps - Tableau de dépendances : re-fetch quand une valeur change (comme useEffect)
 * @param opts - Options supplémentaires transmises à apiFetch
 */
export function useFetch<T = unknown>(
  url:  string | null,
  deps: unknown[] = [],
  opts: Omit<ApiFetchOptions, 'method' | 'body'> = {},
): UseFetchResult<T> {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Référence stable des options pour éviter une dépendance de useEffect instable
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Compteur de version pour ignorer les réponses obsolètes (race conditions)
  const versionRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!url) return;

    const version = ++versionRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await apiFetch<T>(url, { method: 'GET', ...optsRef.current });
      if (version === versionRef.current) {
        setData(result);
      }
    } catch (err) {
      if (version === versionRef.current) {
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      }
    } finally {
      if (version === versionRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
