import { Logger } from '@nestjs/common';
import type { ISecretService } from '../../../infrastructure/secret/interfaces/secret.interface';
import type { GeoProvider, GeoSearchOptions, GeoSearchResult } from './geo-provider.interface';

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT     = 5_000;
const KEY_CACHE_TTL_MS    = 5 * 60 * 1_000;

/**
 * Provider Google Geocoding API. Reutilise la clef API platform/google-maps
 * (meme clef que le routing — Google autorise une clef pour plusieurs APIs
 * dans le meme projet GCP, avec restrictions par API cote console).
 *
 * Cache 5 min de la clef Vault (aligne sur les autres providers Vault-backed).
 *
 * Couvre tres bien l'Afrique francophone (CG, SN, CI, CM, GA, etc.) — c'est
 * pour ca qu'on le place en tete de la chaine de fallback.
 */
export class GoogleGeocodingProvider implements GeoProvider {
  readonly name = 'google' as const;
  private readonly log = new Logger(GoogleGeocodingProvider.name);
  private cachedKey: string | null = null;
  private cachedAt = 0;

  constructor(private readonly secrets: ISecretService) {}

  async isConfigured(): Promise<boolean> {
    try {
      const key = await this.getApiKey();
      return Boolean(key && key.length > 0);
    } catch {
      return false;
    }
  }

  async search(query: string, options?: GeoSearchOptions): Promise<GeoSearchResult[]> {
    const key = await this.getApiKey();
    const cc = options?.countryCode?.toUpperCase();
    const limit = options?.limit ?? 5;

    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set('address', query);
    url.searchParams.set('key', key);
    url.searchParams.set('language', 'fr');
    if (cc) url.searchParams.set('region', cc.toLowerCase());
    if (cc) url.searchParams.set('components', `country:${cc}`);

    const raw = await this.fetchJson(url.toString());
    return this.normalize(raw, cc).slice(0, limit);
  }

  async reverse(lat: number, lng: number, options?: GeoSearchOptions): Promise<GeoSearchResult | null> {
    const key = await this.getApiKey();
    const url = new URL(GOOGLE_GEOCODE_URL);
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', key);
    url.searchParams.set('language', 'fr');
    if (options?.countryCode) {
      url.searchParams.set('result_type', 'street_address|premise|route|locality');
    }

    const raw = await this.fetchJson(url.toString());
    const list = this.normalize(raw);
    return list[0] ?? null;
  }

  // ── Privé ────────────────────────────────────────────────────────────

  private async getApiKey(): Promise<string> {
    const now = Date.now();
    if (this.cachedKey && now - this.cachedAt < KEY_CACHE_TTL_MS) return this.cachedKey;
    const key = await this.secrets.getSecret('platform/google-maps', 'API_KEY');
    this.cachedKey = key;
    this.cachedAt = now;
    return key;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normalise la reponse Google.
   *
   * Reponse Google :
   *   { status: 'OK' | 'ZERO_RESULTS' | …, results: [{
   *       formatted_address: string,
   *       geometry: { location: { lat, lng }, location_type, viewport },
   *       address_components: [{ short_name, types: [string] }, …],
   *       types: [string],
   *   }, …] }
   *
   * Si `status !== OK`, retourne tableau vide (le service tentera le fallback).
   */
  private normalize(raw: unknown, cc?: string): GeoSearchResult[] {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    if (r.status !== 'OK') {
      if (r.status && r.status !== 'ZERO_RESULTS') {
        this.log.warn(`Google Geocoding status=${String(r.status)}`);
      }
      return [];
    }
    const results = Array.isArray(r.results) ? r.results : [];
    const out: GeoSearchResult[] = [];
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, unknown>;
      const displayName = typeof it.formatted_address === 'string' ? it.formatted_address : '';
      const geometry = it.geometry as { location?: { lat?: number; lng?: number } } | undefined;
      const lat = Number(geometry?.location?.lat);
      const lng = Number(geometry?.location?.lng);
      let countryCode = '';
      const components = Array.isArray(it.address_components) ? it.address_components : [];
      for (const c of components) {
        const cc2 = c as { short_name?: string; types?: unknown[] };
        if (Array.isArray(cc2.types) && cc2.types.includes('country') && typeof cc2.short_name === 'string') {
          countryCode = cc2.short_name.toUpperCase();
          break;
        }
      }
      if (
        !displayName ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;
      if (cc && countryCode && countryCode !== cc) continue;
      out.push({ displayName: displayName.slice(0, 240), lat, lng, countryCode });
    }
    return out;
  }
}
