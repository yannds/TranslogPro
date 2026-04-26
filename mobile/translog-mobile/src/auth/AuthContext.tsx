/**
 * AuthContext mobile — source de vérité pour la session courante.
 *
 * Auth-flow (mobile multi-tenant SaaS) :
 *   1. login(email, password) → POST sur api.<rootDomain>/api/auth/sign-in-cross-tenant
 *      - serveur cherche l'user globalement, valide le password
 *      - retourne { token, tenantHost, ...user } OU { multiple: tenants[] }
 *   2. Si multiple : on remonte la liste pour le picker UI ; le 2e essai
 *      ajoute `preferredTenantSlug`.
 *   3. setApiHost(tenantHost) → toutes les requêtes suivantes pointent là
 *   4. setAuthToken(token) → header Authorization: Bearer sur tous les calls
 *   5. apiGet('/api/auth/me') → re-fetch profil pour normaliser le DTO
 *
 * Démarrage : si un token + un host sont en storage, /api/auth/me hydrate
 * le user. Sur 401 → token effacé, host conservé (le user peut juste
 * re-saisir password).
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiGet, apiPost, ApiError } from '../api/client';
import { setAuthToken, clearAuthToken, getAuthToken } from './token';
import {
  setApiHost,
  urlToHost,
  type ApiHost,
  DEFAULT_API_ROOT_DOMAIN,
} from '../api/host-store';

export interface AuthUser {
  id:                string;
  email:             string;
  name:              string | null;
  tenantId:          string;
  effectiveTenantId: string;
  tenantSlug:        string | null;
  roleId:            string | null;
  roleName:          string | null;
  userType:          string;
  staffId:           string | null;
  agencyId:          string | null;
  enabledModules:    string[];
  permissions:       string[];
}

/** Réponse "ambiguïté" : le même email/password matche plusieurs tenants. */
export interface MultiTenantChoice {
  multiple: true;
  tenants:  Array<{ slug: string; name: string }>;
}

/** Réponse "MFA requis" : le compte a TOTP activé, le caller doit demander
 *  le code à 6 chiffres et appeler `verifyMfa(code, challengeToken)`. */
export interface MfaPending {
  mfaRequired:    true;
  challengeToken: string;
  expiresAt:      string;
  tenantHost:     string;
}

interface AuthContextValue {
  user:    AuthUser | null;
  loading: boolean;
  error:   string | null;
  /**
   * Connexion. Renvoie :
   *   - `null` si la session est créée (cas standard, sans MFA).
   *   - `{ multiple, tenants }` si l'email a un compte sur plusieurs sociétés.
   *   - `{ mfaRequired, challengeToken, ... }` si le compte a TOTP activé →
   *      le caller doit afficher le step MFA et appeler `verifyMfa()`.
   */
  login:    (email: string, password: string, preferredTenantSlug?: string) => Promise<MultiTenantChoice | MfaPending | null>;
  /** Étape 2 du flow MFA : valide le code TOTP + le challengeToken. */
  verifyMfa: (code: string, challengeToken: string) => Promise<void>;
  logout:   () => Promise<void>;
  refresh:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * URL du endpoint cross-tenant — toujours `api.<rootDomain>` pour
 * profiter de la résolution globale (pas de tenant par sous-domaine).
 */
function crossTenantSignInUrl(rootDomain: string = DEFAULT_API_ROOT_DOMAIN): string {
  return `https://api.${rootDomain}/api/auth/sign-in-cross-tenant`;
}

function crossTenantMfaVerifyUrl(rootDomain: string = DEFAULT_API_ROOT_DOMAIN): string {
  return `https://api.${rootDomain}/api/auth/mfa/verify-cross-tenant`;
}

interface CrossTenantResponse {
  // Cas succès : on reçoit AuthUser + token + tenantHost
  token?:      string;
  tenantHost?: string;
  // ou cas multi-tenant
  multiple?:   true;
  tenants?:    Array<{ slug: string; name: string }>;
  // ou MFA pending
  mfaRequired?:    true;
  challengeToken?: string;
  expiresAt?:      string;
  // ...AuthUser fields (réponse succès uniquement)
  id?:         string;
  email?:      string;
  tenantSlug?: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  async function refresh() {
    try {
      let token: string | null = null;
      try { token = await getAuthToken(); } catch { token = null; }
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

  async function login(
    email: string,
    password: string,
    preferredTenantSlug?: string,
  ): Promise<MultiTenantChoice | MfaPending | null> {
    const url = crossTenantSignInUrl();
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        email:    email.trim(),
        password,
        ...(preferredTenantSlug ? { preferredTenantSlug } : {}),
      }),
    });

    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* ignore */ }
      const detail =
        body && typeof body === 'object' && 'detail' in body && typeof (body as Record<string, unknown>).detail === 'string'
          ? (body as Record<string, string>).detail
          : `Erreur ${res.status}`;
      throw new Error(detail);
    }

    const data = await res.json() as CrossTenantResponse;

    // Cas 1 : email présent sur plusieurs tenants → on remonte le choix.
    if (data.multiple) {
      return { multiple: true, tenants: data.tenants ?? [] };
    }

    // Cas 2 : MFA exigé — on remonte le challenge au caller pour qu'il
    // affiche l'écran code à 6 chiffres. Pas de session créée à ce stade.
    if (data.mfaRequired) {
      if (!data.challengeToken || !data.tenantHost || !data.expiresAt) {
        throw new Error('Réponse MFA serveur invalide.');
      }
      return {
        mfaRequired:    true,
        challengeToken: data.challengeToken,
        expiresAt:      data.expiresAt,
        tenantHost:     data.tenantHost,
      };
    }

    // Cas 3 : succès — on persiste host + token, puis on hydrate l'user via /me.
    if (!data.token || !data.tenantHost) {
      throw new Error('Réponse serveur invalide (token ou tenantHost manquant).');
    }

    await persistSession(data.tenantHost, data.token);
    return null;
  }

  async function verifyMfa(code: string, challengeToken: string): Promise<void> {
    const url = crossTenantMfaVerifyUrl();
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code: code.trim(), challengeToken }),
    });

    if (!res.ok) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* ignore */ }
      const detail =
        body && typeof body === 'object' && 'detail' in body && typeof (body as Record<string, unknown>).detail === 'string'
          ? (body as Record<string, string>).detail
          : `Erreur ${res.status}`;
      throw new Error(detail);
    }

    const data = await res.json() as CrossTenantResponse;
    if (!data.token || !data.tenantHost) {
      throw new Error('Réponse serveur invalide après MFA.');
    }
    await persistSession(data.tenantHost, data.token);
  }

  async function persistSession(tenantHost: string, token: string): Promise<void> {
    const host: ApiHost | null = urlToHost(`https://${tenantHost}`);
    if (!host) throw new Error('tenantHost invalide.');
    await setApiHost(host);
    await setAuthToken(token);
    // Re-fetch /me sur le tenantHost pour normaliser le DTO complet
    // (permissions, enabledModules, agencyId — qui ne sont pas tous dans
    // la réponse cross-tenant légère).
    const me = await apiGet<AuthUser>('/api/auth/me', { skipAuthRedirect: true });
    setUser(me);
  }

  async function logout() {
    try { await apiPost('/api/auth/sign-out'); } catch { /* best-effort */ }
    await clearAuthToken();
    // On garde le tenantHost pour que le user n'ait pas à le ressaisir au
    // prochain login (UX). Pour le forcer à changer de société, il y a un
    // bouton dédié dans le profil (clearTenant() sur le TenantHostProvider).
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, login, verifyMfa, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
