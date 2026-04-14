/**
 * api.ts — Client HTTP centralisé pour TranslogPro
 *
 * Fonctionnalités :
 *   - apiFetch<T>()  : wrapper fetch avec credentials, gestion 401 → redirect /login
 *   - apiGet / apiPost / apiPatch / apiDelete : raccourcis typés
 *   - ApiError       : classe d'erreur enrichie (status + body)
 *
 * Authentification : session-cookie (credentials: 'include'), pas de JWT en header.
 * Toutes les requêtes sont relatives à /api pour éviter le hard-coding de l'URL.
 */

// ─── Classe d'erreur enrichie ─────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body:   unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Cœur du client ───────────────────────────────────────────────────────────

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** Corps de la requête (sérialisé en JSON automatiquement) */
  body?: unknown;
  /** Base URL — par défaut '' (chemin relatif au document courant) */
  baseUrl?: string;
}

/**
 * apiFetch<T> — point d'entrée unique pour toutes les requêtes API.
 *
 * - Ajoute Content-Type: application/json si un body est fourni.
 * - Ajoute credentials: 'include' pour les cookies de session.
 * - Redirige vers /login en cas de 401 (session expirée).
 * - Lance une ApiError pour tout statut >= 400.
 */
export async function apiFetch<T = unknown>(
  path: string,
  { body, baseUrl = '', ...init }: ApiFetchOptions = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;

  const headers = new Headers(init.headers);
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Session expirée → redirect vers la page de login
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new ApiError(401, null, 'Session expirée — redirection vers /login');
  }

  if (!res.ok) {
    let errorBody: unknown = null;
    try { errorBody = await res.json(); } catch { /* ignore */ }
    throw new ApiError(
      res.status,
      errorBody,
      `Erreur API ${res.status} sur ${path}`,
    );
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

// ─── Raccourcis ───────────────────────────────────────────────────────────────

export const apiGet = <T>(path: string, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) =>
  apiFetch<T>(path, { ...opts, method: 'GET' });

export const apiPost = <T>(path: string, body?: unknown, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) =>
  apiFetch<T>(path, { ...opts, method: 'POST', body });

export const apiPut = <T>(path: string, body?: unknown, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) =>
  apiFetch<T>(path, { ...opts, method: 'PUT', body });

export const apiPatch = <T>(path: string, body?: unknown, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) =>
  apiFetch<T>(path, { ...opts, method: 'PATCH', body });

export const apiDelete = <T>(path: string, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) =>
  apiFetch<T>(path, { ...opts, method: 'DELETE' });
