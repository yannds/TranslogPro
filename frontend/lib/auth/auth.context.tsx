/**
 * auth.context.tsx — Contexte d'authentification TranslogPro
 *
 * Fournit :
 *   - user     : utilisateur connecté ou null
 *   - loading  : true pendant la vérification de session initiale
 *   - login()  : POST /api/auth/sign-in → cookie de session
 *   - logout() : POST /api/auth/sign-out → supprime la session
 *
 * Usage :
 *   <AuthProvider>...</AuthProvider>
 *   const { user, login, logout } = useAuth();
 */

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react';
import { apiFetch } from '../api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:       string;
  email:    string;
  name:     string;
  tenantId: string;
  roleId:   string | null;
  roleName: string;
  agencyId: string | undefined;
  userType: string;
}

interface AuthContextValue {
  user:    AuthUser | null;
  loading: boolean;
  login:   (email: string, password: string) => Promise<void>;
  logout:  () => Promise<void>;
}

// ─── Contexte ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Vérification de session au montage
  useEffect(() => {
    apiFetch<AuthUser>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiFetch<AuthUser>('/api/auth/sign-in', {
      method: 'POST',
      body: { email, password },
    });
    setUser(result);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
    setUser(null);
    window.location.href = '/login';
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
