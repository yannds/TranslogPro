import { Logger } from '@nestjs/common';
import type { ISecretService } from '../../../infrastructure/secret/interfaces/secret.interface';
import type { GeoProvider, GeoSearchOptions, GeoSearchResult } from './geo-provider.interface';

const MAPBOX_BASE       = 'https://api.mapbox.com/geocoding/v5/mapbox.places';
const REQUEST_TIMEOUT   = 5_000;
const KEY_CACHE_TTL_MS  = 5 * 60 * 1_000;

/**
 * Provider Mapbox Geocoding API. Reutilise le token platform/mapbox (meme
 * token que le routing Mapbox Directions — autorise par les CGU Mapbox).
 *
 * Position dans la chaine de fallback : entre Google et Nominatim. Couverture
 * Afrique correcte (legerement moins bonne que Google sur les zones rurales,
 * mais suffisante en ville). Tarification ~5x moins chere que Google.
 *
 * CGU clean : Mapbox autorise le stockage des coordonnees long-terme sans
 * obligation d'afficher sur une carte Mapbox specifiquement.
 */
export class MapboxGeocodingProvider implements GeoProvider {
  readonly name = 'mapbox' as const;
  private readonly log = new Logger(MapboxGeocodingProvider.name);
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

    const url = new URL(`${MAPBOX_BASE}/${encodeURIComponent(query)}.json`);
    url.searchParams.set('access_token', key);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('language', 'fr,en');
    if (cc) url.searchParams.set('country', cc.toLowerCase());

    const raw = await this.fetchJson(url.toString());
    return this.normalize(raw, cc);
  }

  async reverse(lat: number, lng: number, _options?: GeoSearchOptions): Promise<GeoSearchResult | null> {
    const key = await this.getApiKey();
    // Mapbox veut lng,lat (ordre inverse)
    const url = new URL(`${MAPBOX_BASE}/${lng},${lat}.json`);
    url.searchParams.set('access_token', key);
    url.searchParams.set('limit', '1');
    url.searchParams.set('language', 'fr,en');

    const raw = await this.fetchJson(url.toString());
    const list = this.normalize(raw);
    return list[0] ?? null;
  }

  // ── Privé ────────────────────────────────────────────────────────────

  private async getApiKey(): Promise<string> {
    const now = Date.now();
    if (this.cachedKey && now - this.cachedAt < KEY_CACHE_TTL_MS) return this.cachedKey;
    const key = await this.secrets.getSecret('platform/mapbox', 'API_KEY');
    this.cachedKey = key;
    this.cachedAt = now;
    return key;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Normalise la reponse Mapbox.
   *
   * Reponse :
   *   { type: 'FeatureCollection', features: [{
   *       place_name: string,
   *       center: [lng, lat],
   *       geometry: { coordinates: [lng, lat] },
   *       context: [{ id: 'country.xxx', short_code: 'cg', text: 'Congo' }, …],
   *   }, …] }
   */
  private normalize(raw: unknown, cc?: string): GeoSearchResult[] {
    if (!raw || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    const features = Array.isArray(r.features) ? r.features : [];
    const out: GeoSearchResult[] = [];
    for (const item of features) {
      if (!item || typeof item !== 'object') continue;
      const f = item as Record<string, unknown>;
      const placeName = typeof f.place_name === 'string' ? f.place_name : '';
      const center = Array.isArray(f.center) ? f.center : [];
      const lng = Number(center[0]);
      const lat = Number(center[1]);
      let countryCode = '';
      const context = Array.isArray(f.context) ? f.context : [];
      for (const ctx of context) {
        const c = ctx as { id?: string; short_code?: string };
        if (typeof c.id === 'string' && c.id.startsWith('country.') && typeof c.short_code === 'string') {
          countryCode = c.short_code.toUpperCase();
          break;
        }
      }
      // Cas ou la feature elle-meme est un pays
      if (!countryCode) {
        const placeType = Array.isArray(f.place_type) ? f.place_type : [];
        if (placeType.includes('country') && typeof f.short_code === 'string') {
          countryCode = String(f.short_code).toUpperCase();
        }
      }
      if (
        !placeName ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;
      if (cc && countryCode && countryCode !== cc) continue;
      out.push({ displayName: placeName.slice(0, 240), lat, lng, countryCode });
    }
    return out;
  }
}
