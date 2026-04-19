/**
 * Client HTTP — adapté du `frontend/lib/api.ts` pour React Native.
 *
 * Différences clés :
 *   - auth = Bearer token lu via expo-secure-store (pas de cookie de session)
 *   - baseUrl configurable par env (cf. config.ts)
 *   - en cas d'offline (network error), lève une OfflineError typée pour laisser
 *     le caller basculer en mode outbox.
 */

import { getApiBaseUrl, getDevTenantHost } from './config';
import { getAuthToken } from '../auth/token';

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

export class OfflineError extends Error {
  constructor() {
    super('OFFLINE');
    this.name = 'OfflineError';
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  body?:        unknown;
  /** Évite un logout auto sur 401 (ex: check session initial). */
  skipAuthRedirect?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  { body, skipAuthRedirect = false, ...init }: ApiFetchOptions = {},
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  const headers = new Headers(init.headers);

  const token = await getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Dev : précise au backend quel tenant résoudre quand on tape localhost.
  // Stripé par le reverse-proxy en prod — aucun effet hors NODE_ENV=development.
  const tenantHost = getDevTenantHost();
  if (tenantHost && !headers.has('X-Tenant-Host')) {
    headers.set('X-Tenant-Host', tenantHost);
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isString   = typeof body === 'string';
  if (body !== undefined && !isFormData && !isString && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const serializedBody: BodyInit | undefined =
      body === undefined ? undefined
    : isFormData         ? (body as BodyInit)
    : isString           ? (body as string)
                         : JSON.stringify(body);

  let res: Response;
  try {
    // credentials: 'include' : important pour que le navigateur / le jar natif
    // envoie le cookie translog_session (session backend). Sans ça l'auth /me
    // revient 401 juste après un login qui a pourtant bien posé le Set-Cookie.
    res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers,
      body: serializedBody,
    });
  } catch {
    // TypeError => réseau down / DNS / timeout
    throw new OfflineError();
  }

  if (res.status === 401 && !skipAuthRedirect) {
    // Le caller décide du logout via AuthProvider (pas d'accès router ici).
    throw new ApiError(401, null, 'Session expirée');
  }

  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg =
      (body && typeof body === 'object' && 'message' in body && typeof (body as Record<string, unknown>).message === 'string')
        ? (body as Record<string, string>).message
        : `Erreur API ${res.status}`;
    throw new ApiError(res.status, body, msg);
  }

  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  if (!text) return null as unknown as T;
  return JSON.parse(text) as T;
}

export const apiGet    = <T>(p: string, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) => apiFetch<T>(p, { ...opts, method: 'GET' });
export const apiPost   = <T>(p: string, body?: unknown, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) => apiFetch<T>(p, { ...opts, method: 'POST', body });
export const apiPatch  = <T>(p: string, body?: unknown, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) => apiFetch<T>(p, { ...opts, method: 'PATCH', body });
export const apiDelete = <T>(p: string, opts?: Omit<ApiFetchOptions, 'method' | 'body'>) => apiFetch<T>(p, { ...opts, method: 'DELETE' });
