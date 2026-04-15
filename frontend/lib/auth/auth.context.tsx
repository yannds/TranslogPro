/**
 * auth.context.tsx — Contexte d'authentification TranslogPro
 *
 * Fournit :
 *   - user     : utilisateur connecté ou null
 *   - loading  : true pendant la vérification de session initiale
 *   - login()  : POST /api/auth/sign-in → cookie de session
 *   - logout() : POST /api/auth/sign-out → supprime la session + redirect /login
 */

import {
  createContext, useContext, useState, useEffect, useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:       string;
  email:    string;
  name:     string | null;
  tenantId: string;
  roleId:   string | null;
  roleName: string | null;
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
  const navigate = useNavigate();

  // Vérification de session au montage — skipRedirectOn401 évite la boucle infinie
  useEffect(() => {
    apiFetch<AuthUser>('/api/auth/me', { skipRedirectOn401: true })
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await apiFetch<AuthUser>('/api/auth/sign-in', {
      method:            'POST',
      body:              { email, password },
      skipRedirectOn401: true,
    });
    setUser(result);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/sign-out', { method: 'POST' });
    } catch {
      // Session déjà expirée côté serveur — on nettoie quand même
    }
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

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
