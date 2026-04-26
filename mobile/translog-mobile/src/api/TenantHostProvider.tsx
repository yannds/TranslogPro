/**
 * TenantHostProvider — contexte React qui expose le slug tenant courant
 * et permet de le changer (avec persistance + re-render des consumers).
 *
 * Le store sous-jacent (`host-store.ts`) reste un singleton accessible hors
 * arbre React (apiFetch, outbox, etc.). Ce provider est juste la couche
 * réactive pour les composants UI (login, profil, switch société).
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  type ApiHost,
  bootstrapApiHost,
  getApiHost,
  setApiHost as storeSetApiHost,
  subscribeApiHost,
  pingTenant,
  DEFAULT_API_ROOT_DOMAIN,
} from './host-store';

interface TenantHostCtx {
  host:        ApiHost | null;
  loading:     boolean;
  /** Définit le tenant courant + persiste. Triggera un re-render de l'app. */
  setTenant:   (slug: string, opts?: { rootDomain?: string; protocol?: 'http' | 'https' }) => Promise<void>;
  /** Efface le tenant courant (logout + retour écran sélection). */
  clearTenant: () => Promise<void>;
  /** Ping live le tenant pour valider qu'il existe avant qu'on l'enregistre. */
  pingTenant:  (slug: string, opts?: { rootDomain?: string; protocol?: 'http' | 'https' }) => Promise<{ ok: boolean; reason?: string }>;
}

const Context = createContext<TenantHostCtx | null>(null);

export function TenantHostProvider({ children }: { children: ReactNode }) {
  const [host,    setHost]    = useState<ApiHost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initial = await bootstrapApiHost();
      if (cancelled) return;
      // Si pas de host stocké mais env présent (mode tunnel dev), on hydrate
      // depuis getApiHost() qui parse l'env.
      setHost(initial ?? getApiHost());
      setLoading(false);
    })();
    const unsub = subscribeApiHost((next) => {
      if (!cancelled) setHost(next);
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const setTenant = useCallback(async (
    slug: string,
    opts?: { rootDomain?: string; protocol?: 'http' | 'https' },
  ) => {
    const rootDomain = opts?.rootDomain ?? DEFAULT_API_ROOT_DOMAIN;
    const protocol   = opts?.protocol   ?? 'https';
    await storeSetApiHost({ slug: slug.trim().toLowerCase(), rootDomain, protocol });
  }, []);

  const clearTenant = useCallback(async () => {
    await storeSetApiHost(null);
  }, []);

  const ping = useCallback(async (
    slug: string,
    opts?: { rootDomain?: string; protocol?: 'http' | 'https' },
  ) => {
    return pingTenant({
      slug:       slug.trim().toLowerCase(),
      rootDomain: opts?.rootDomain ?? DEFAULT_API_ROOT_DOMAIN,
      protocol:   opts?.protocol   ?? 'https',
    });
  }, []);

  return (
    <Context.Provider value={{ host, loading, setTenant, clearTenant, pingTenant: ping }}>
      {children}
    </Context.Provider>
  );
}

export function useTenantHost(): TenantHostCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useTenantHost must be inside TenantHostProvider');
  return ctx;
}
