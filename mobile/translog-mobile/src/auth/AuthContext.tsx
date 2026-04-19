/**
 * AuthContext mobile — source de vérité pour la session courante.
 *
 * Auth-flow :
 *   1. Démarrage → tente GET /api/auth/me avec token Secure Store.
 *   2. Succès → user en contexte, navigation vers tabs par rôle.
 *   3. Échec 401 → token effacé, retour login.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiError } from '../api/client';
import { setAuthToken, clearAuthToken, getAuthToken } from './token';

export interface AuthUser {
  id:              string;
  email:           string;
  name:            string | null;
  tenantId:        string;
  effectiveTenantId: string;
  tenantSlug:      string | null;
  roleId:          string | null;
  roleName:        string | null;
  userType:        string;
  staffId:         string | null;
  agencyId:        string | null;
  enabledModules:  string[];
  permissions:     string[];
}

interface AuthContextValue {
  user:    AuthUser | null;
  loading: boolean;
  error:   string | null;
  login:   (email: string, password: string) => Promise<void>;
  logout:  () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function refresh() {
    try {
      // getAuthToken() peut throw si le storage natif est indisponible
      // (ex: Web sans polyfill SecureStore). On attrape tout pour garantir
      // que `loading` bascule à false et que l'UI (login) s'affiche.
      let token: string | null = null;
      try {
        token = await getAuthToken();
      } catch {
        token = null;
      }
      if (!token) { setUser(null); return; }
      try {
        const me = await apiGet<AuthUser>('/api/auth/me', { skipAuthRedirect: true });
        setUser(me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          try { await clearAuthToken(); } catch { /* noop */ }
          setUser(null);
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function login(email: string, password: string) {
    // Le backend NestJS pose un cookie HttpOnly `translog_session` et
    // retourne le profil utilisateur dans le body (pas de token JSON).
    // Côté web : le cookie est suivi automatiquement par `credentials: 'include'`.
    // Côté natif : expo gère le jar implicite quand `credentials` est posé.
    // On ne stocke donc PAS de bearer token côté client — la session vit
    // dans le cookie pour toute la durée de vie de l'app.
    const me = await apiPost<AuthUser>(
      '/api/auth/sign-in',
      { email, password },
      { skipAuthRedirect: true, credentials: 'include' },
    );
    setUser(me);
  }

  async function logout() {
    try { await apiPost('/api/auth/sign-out'); } catch { /* best-effort */ }
    await clearAuthToken();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
