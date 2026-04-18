/**
 * TenantScopeProvider — contexte de "tenant actif" pour le staff plateforme.
 *
 * Problème résolu : les pages tenant-scoped (Trips, Fleet, Cashier, Analytics,
 * Incidents…) utilisent `user.tenantId` pour leurs appels API. Pour un agent
 * du tenant plateforme, ce tenantId vaut `PLATFORM_TENANT_ID` — les requêtes
 * retournent alors vide ou 404. Aucun agent plateforme n'a de « son tenant ».
 *
 * Solution propre (pas de cache de nav) : un sélecteur global sticky permet
 * à l'agent plateforme de choisir un tenant cible. Les pages lisent
 * `useScopedTenantId() ?? user.tenantId` au lieu de `user.tenantId`.
 *
 *   - Pour un user tenant normal : `useScopedTenantId()` retourne toujours null
 *     → les pages utilisent user.tenantId comme d'habitude.
 *   - Pour un user plateforme : la valeur est persistée dans sessionStorage
 *     et rétablie au reload. `null` tant qu'aucun choix — les pages affichent
 *     alors `<NoTenantScope />`.
 *
 * À noter : ce scope n'accorde AUCUNE permission. Le backend refuse toujours
 * un agent plateforme n'ayant pas la permission data.*.global. Pour opérer en
 * écriture sur le tenant cible, utiliser l'impersonation JIT (page dédiée).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/auth.context';

export const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000000';
const STORAGE_KEY = 'translog.platform.scopedTenantId';

export interface ScopedTenant {
  id:   string;
  name: string;
  slug: string;
}

interface TenantScopeContextValue {
  /** true si le user courant est staff du tenant plateforme */
  isPlatformUser:   boolean;
  /** tenantId courant scopé (null si pas choisi, ou si user tenant normal) */
  scopedTenantId:   string | null;
  /** infos du tenant choisi — null si aucun */
  scopedTenant:     ScopedTenant | null;
  setScope:         (tenant: ScopedTenant | null) => void;
  clearScope:       () => void;
}

const TenantScopeContext = createContext<TenantScopeContextValue | null>(null);

export function TenantScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isPlatformUser = user?.tenantId === PLATFORM_TENANT_ID;

  const [scopedTenant, setScopedTenant] = useState<ScopedTenant | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ScopedTenant;
      return parsed?.id ? parsed : null;
    } catch {
      return null;
    }
  });

  // Si l'utilisateur n'est plus plateforme (déconnexion, changement de compte),
  // on nettoie le scope pour éviter toute fuite.
  useEffect(() => {
    if (!isPlatformUser && scopedTenant) {
      setScopedTenant(null);
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    }
  }, [isPlatformUser, scopedTenant]);

  const setScope = useCallback((tenant: ScopedTenant | null) => {
    setScopedTenant(tenant);
    try {
      if (tenant) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tenant));
      else        sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* sessionStorage indisponible (safari private) */ }
  }, []);

  const clearScope = useCallback(() => setScope(null), [setScope]);

  const value = useMemo<TenantScopeContextValue>(() => ({
    isPlatformUser,
    scopedTenantId: scopedTenant?.id ?? null,
    scopedTenant,
    setScope,
    clearScope,
  }), [isPlatformUser, scopedTenant, setScope, clearScope]);

  return (
    <TenantScopeContext.Provider value={value}>
      {children}
    </TenantScopeContext.Provider>
  );
}

export function useTenantScope(): TenantScopeContextValue {
  const ctx = useContext(TenantScopeContext);
  if (!ctx) throw new Error('useTenantScope must be used within <TenantScopeProvider>');
  return ctx;
}

/**
 * Hook utilitaire pour les pages tenant-scoped.
 * Retourne le tenantId effectif : scope plateforme > tenantId du user.
 * Pour un user plateforme sans scope choisi : retourne null (la page doit
 * afficher <NoTenantScope />).
 */
export function useScopedTenantId(): string | null {
  const { user } = useAuth();
  const { isPlatformUser, scopedTenantId } = useTenantScope();
  if (isPlatformUser) return scopedTenantId;
  return user?.tenantId ?? null;
}
