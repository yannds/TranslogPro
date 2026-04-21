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
  /**
   * Si true, un 401 lève une ApiError sans rediriger vers /login.
   * Utile pour le check initial de session (on veut juste null, pas un reload).
   */
  skipRedirectOn401?: boolean;
  /**
   * Token Cloudflare Turnstile (CAPTCHA) — envoyé en header `x-captcha-token`.
   * Requis sur les POST publics annotés `@RequireCaptcha()` côté backend quand
   * `TenantBusinessConfig.captchaEnabled = true`.
   */
  captchaToken?: string | null;
  /**
   * Clé d'idempotence UUID (header `Idempotency-Key`). Requis sur les POST
   * publics annotés `@Idempotent()`. Si omis, le backend exécute sans cache —
   * un double-submit peut alors produire 2 ressources.
   */
  idempotencyKey?: string;
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
  { body, baseUrl = '', skipRedirectOn401 = false, captchaToken, idempotencyKey, ...init }: ApiFetchOptions = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;

  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isBlob     = typeof Blob    !== 'undefined' && body instanceof Blob;
  const isString   = typeof body === 'string';

  // Pour FormData / Blob / string : ne jamais forcer Content-Type (boundary auto, etc.)
  if (body !== undefined && !isFormData && !isBlob && !isString && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  // Sécurité endpoints publics : headers opt-in
  if (captchaToken) headers.set('x-captcha-token', captchaToken);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);

  const serializedBody: BodyInit | undefined =
    body === undefined              ? undefined
    : (isFormData || isBlob)         ? (body as BodyInit)
    : isString                       ? (body as string)
    : JSON.stringify(body);

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
    body: serializedBody,
  });

  if (res.status === 401) {
    if (!skipRedirectOn401 && typeof window !== 'undefined') {
      // Dispatch un événement — l'AuthProvider navigue via React Router
      // (évite le hard-reload qui crée une boucle infinie de rechargements)
      if (!window.location.pathname.startsWith('/login')) {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
    }
    throw new ApiError(401, null, 'Session expirée');
  }

  if (!res.ok) {
    let errorBody: unknown = null;
    try { errorBody = await res.json(); } catch { /* ignore */ }

    // Extraire le message le plus utile du body d'erreur NestJS
    const detail =
      (errorBody && typeof errorBody === 'object' && 'detail' in errorBody && typeof (errorBody as Record<string, unknown>).detail === 'string')
        ? (errorBody as Record<string, string>).detail
      : (errorBody && typeof errorBody === 'object' && 'message' in errorBody && typeof (errorBody as Record<string, unknown>).message === 'string')
        ? (errorBody as Record<string, string>).message
      : null;

    throw new ApiError(
      res.status,
      errorBody,
      detail ?? `Erreur API ${res.status} sur ${path}`,
    );
  }

  // 204 No Content ou body vide (NestJS retourne 200 + Content-Length: 0 pour null)
  if (res.status === 204) return undefined as unknown as T;

  const contentLength = res.headers.get('content-length');
  if (contentLength === '0') return null as unknown as T;

  const text = await res.text();
  if (!text) return null as unknown as T;

  return JSON.parse(text) as T;
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
