/**
 * host-store — source de vérité runtime de l'API base URL.
 *
 * L'app est multi-tenant SaaS : un même bundle peut servir n'importe quel
 * tenant client (`<slug>.translog.dsyann.info`) ou la plateforme super-admin
 * (`admin.translog.dsyann.info`). Le slug est saisi par l'utilisateur au
 * premier login, persisté localement, et toute requête sortante est routée
 * vers `https://<slug>.<rootDomain>`.
 *
 * Ce store est un singleton léger (pas un context) : `apiFetch` n'est pas
 * un hook — il doit pouvoir lire la base URL en dehors d'une arborescence
 * React (background sync, outbox, scheduler).
 *
 * Ordre de résolution :
 *   1. valeur runtime poussée via `setApiHost()` (login flow)
 *   2. AsyncStorage (slug + rootDomain persistés au login précédent)
 *   3. `EXPO_PUBLIC_API_BASE_URL` (build-time env, ex: tunnel dev)
 *   4. `expo.extra.apiBaseUrl` (app.json fallback)
 *   5. `http://localhost:3000` (dev local sans rien)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'translog_api_host';
const DEFAULT_ROOT_DOMAIN = 'translog.dsyann.info';
const DEFAULT_FALLBACK_URL = 'http://localhost:3000';

export interface ApiHost {
  /** Slug tenant (ex: 'typhoon-express') ou 'admin' pour la plateforme. */
  slug:        string;
  /** Domaine racine (ex: 'translog.dsyann.info'). Permet self-host éventuel. */
  rootDomain:  string;
  /** Protocole (https en prod, http accepté pour dev local). */
  protocol:    'http' | 'https';
}

let _current: ApiHost | null = null;
const _listeners = new Set<(host: ApiHost | null) => void>();

/** Construit l'URL absolue à partir d'un ApiHost. */
export function hostToUrl(h: ApiHost): string {
  return `${h.protocol}://${h.slug}.${h.rootDomain}`;
}

/** Parse une URL https://<slug>.<rootDomain> en ApiHost. Retourne null si pas parseable. */
export function urlToHost(url: string): ApiHost | null {
  try {
    const u = new URL(url);
    const protocol = u.protocol === 'https:' ? 'https' : 'http';
    const parts = u.hostname.split('.');
    if (parts.length < 3) return null; // pas un sous-domaine
    const slug = parts[0];
    const rootDomain = parts.slice(1).join('.');
    return { slug, rootDomain, protocol };
  } catch {
    return null;
  }
}

/**
 * Pousse une nouvelle base URL en runtime + persistance disque.
 * Notifie les listeners (utilisé par TenantHostProvider pour re-render).
 */
export async function setApiHost(host: ApiHost | null): Promise<void> {
  _current = host;
  try {
    if (host) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(host));
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* storage indispo : on garde le runtime */ }
  for (const fn of _listeners) {
    try { fn(host); } catch { /* swallow */ }
  }
}

/**
 * Lit le host courant (runtime → storage → env → fallback).
 * Utilisé par apiFetch — synchrone après bootstrap().
 */
export function getApiBaseUrl(): string {
  if (_current) return hostToUrl(_current);

  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv) return fromEnv;

  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  if (extra.apiBaseUrl) return extra.apiBaseUrl;

  return DEFAULT_FALLBACK_URL;
}

/** Lit le host courant (typed). Null si jamais initialisé. */
export function getApiHost(): ApiHost | null {
  if (_current) return _current;
  // Si on a une URL d'env (cas tunnel dev), on l'expose comme host parsé.
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (fromEnv) return urlToHost(fromEnv);
  return null;
}

/**
 * Charge le host depuis AsyncStorage au démarrage de l'app. À appeler une
 * fois dans le bootstrap (avant le premier render qui a besoin de l'API).
 */
export async function bootstrapApiHost(): Promise<ApiHost | null> {
  if (_current) return _current;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ApiHost;
    if (parsed?.slug && parsed?.rootDomain) {
      _current = parsed;
      return parsed;
    }
  } catch { /* corrompu : on ignore */ }
  return null;
}

/**
 * Subscribe aux changements de host (utilisé par le provider React).
 * Retourne un unsubscribe.
 */
export function subscribeApiHost(fn: (host: ApiHost | null) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/**
 * Vérifie qu'un slug tenant existe en pinguant l'API. Le backend renvoie
 * 401 sur /api/auth/me si le tenant existe (token absent) — c'est notre
 * signal "tenant valide". Tout autre code (404, 5xx, network error) =
 * tenant inconnu ou indisponible.
 */
export async function pingTenant(host: ApiHost): Promise<{ ok: boolean; reason?: string }> {
  try {
    const url = `${hostToUrl(host)}/api/auth/me`;
    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    // 401 = tenant résolu, juste pas de session active. 200 = déjà loggé.
    if (res.status === 401 || res.status === 200) return { ok: true };
    if (res.status === 400) {
      return { ok: false, reason: 'tenant_unknown' };
    }
    return { ok: false, reason: `http_${res.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'network' };
  }
}

export const DEFAULT_API_ROOT_DOMAIN = DEFAULT_ROOT_DOMAIN;
