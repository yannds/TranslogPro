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
import { apiFetch, ApiError } from '../api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImpersonationContextDto {
  sessionId:      string;
  targetTenantId: string;
  targetSlug:     string;
  actorTenantId:  string;
  expiresAt:      string;   // ISO
  reason:         string | null;
}

export interface AuthUser {
  id:             string;
  email:          string;
  name:           string | null;
  /** Tenant natif de l'utilisateur (User.tenantId). Inchangé pendant impersonation. */
  tenantId:       string;
  /**
   * Tenant effectif de la session courante. Diffère de `tenantId` pendant
   * une impersonation JIT (effectiveTenantId = target, tenantId = platform).
   * Utiliser ce champ pour fetcher la config tenant et toutes décisions
   * scopées au tenant courant.
   */
  effectiveTenantId: string;
  roleId:         string | null;
  roleName:       string | null;
  userType:       string;
  /** Id Staff lié — null pour CUSTOMER / SUPER_ADMIN. Requis pour les endpoints :staffId. */
  staffId:        string | null;
  /** Agence RH de l'acteur (Staff.agencyId). Null pour CUSTOMER ou Staff sans agence. */
  agencyId:       string | null;
  /** moduleKey SaaS actifs pour le tenant (ex: 'TICKETING', 'QHSE'). */
  enabledModules: string[];
  /**
   * Permissions résolues backend (source de vérité unique).
   * Ne JAMAIS dériver les perms depuis `roleName` côté frontend — cette liste
   * fait foi pour l'affichage. La sécurité réelle reste sur PermissionGuard.
   */
  permissions:    string[];
  /**
   * Présent ssi la session est une impersonation JIT. Le frontend affiche
   * un banner chrono tant que ce champ est présent.
   */
  impersonation?: ImpersonationContextDto;
  /**
   * Préférences utilisateur self-service (override des défauts tenant).
   * Null = utilise la valeur par défaut du tenant.
   */
  locale?:             string | null;
  timezone?:           string | null;
  /** Indique qu'une rotation forcée de mot de passe est attendue au prochain login. */
  mustChangePassword?: boolean;
  /** True quand MFA activé et confirmé sur ce compte. */
  mfaEnabled?:         boolean;
}

/** Résultat possible de login : soit session OK, soit MFA requis. */
export type LoginResult =
  | { kind: 'session' }
  | { kind: 'mfa'; expiresAt: string };

interface AuthContextValue {
  user:    AuthUser | null;
  loading: boolean;
  /**
   * Retourne `{ kind: 'mfa', expiresAt }` si un challenge MFA est en cours
   * (user.mfaEnabled). L'UI doit alors afficher l'input code 6 chiffres et
   * appeler `verifyMfa(code)` pour finaliser la connexion.
   */
  login:   (email: string, password: string) => Promise<LoginResult>;
  /** Complète un login en attente MFA — pose le cookie de session. */
  verifyMfa: (code: string) => Promise<void>;
  logout:  () => Promise<void>;
  /** Force la relecture du user (utile après toggle de module). */
  refresh: () => Promise<void>;
  /** Change le mot de passe propre — toutes les sessions sont invalidées. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Met à jour locale/timezone sur le user courant (User.preferences). */
  updatePreferences: (patch: { locale?: string; timezone?: string }) => Promise<void>;
}

// ─── Contexte ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Vérification de session au montage — skipRedirectOn401 évite la boucle infinie.
  // On ne clear user QUE sur un vrai 401 : une erreur réseau transitoire (backend
  // qui redémarre en dev, perte de connexion brève) ne doit pas simuler un logout.
  useEffect(() => {
    apiFetch<AuthUser>('/api/auth/me', { skipRedirectOn401: true })
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const result = await apiFetch<AuthUser | { mfaRequired: true; expiresAt: string }>(
      '/api/auth/sign-in',
      { method: 'POST', body: { email, password }, skipRedirectOn401: true },
    );
    // Discrimination : MFA required → pas de user, le cookie pré-session est
    // déjà posé côté serveur, l'UI doit afficher l'input code 6 chiffres.
    if ('mfaRequired' in result && result.mfaRequired) {
      return { kind: 'mfa', expiresAt: result.expiresAt };
    }
    setUser(result as AuthUser);
    return { kind: 'session' };
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    const user = await apiFetch<AuthUser>('/api/auth/mfa/verify', {
      method: 'POST',
      body:   { code },
      skipRedirectOn401: true,
    });
    setUser(user);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body:   { currentPassword, newPassword },
    });
    // Toutes les sessions sont invalidées côté serveur — on purge le contexte
    // local et on redirige vers /login pour cohérence.
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const updatePreferences = useCallback(async (patch: { locale?: string; timezone?: string }) => {
    const updated = await apiFetch<{ locale: string | null; timezone: string | null }>(
      '/api/auth/me/preferences',
      { method: 'PATCH', body: patch },
    );
    setUser(prev => prev ? { ...prev, locale: updated.locale, timezone: updated.timezone } : prev);
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

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiFetch<AuthUser>('/api/auth/me', { skipRedirectOn401: true });
      setUser(fresh);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
    }
  }, []);

  // Revalidation automatique sur retour de focus / reconnexion réseau.
  // Couvre les cas : changement de rôle/perm en DB, session expirée pendant
  // que l'onglet était en arrière-plan, perte/retour de connexion.
  // Pas de polling — on revalide uniquement quand un signal utilisateur arrive.
  useEffect(() => {
    if (!user) return;
    const onFocus  = () => { void refresh(); };
    const onOnline = () => { void refresh(); };
    window.addEventListener('focus',  onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus',  onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [user, refresh]);

  return (
    <AuthContext.Provider value={{
      user, loading, login, verifyMfa, logout, refresh,
      changePassword, updatePreferences,
    }}>
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
