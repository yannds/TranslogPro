import { Logger } from '@nestjs/common';
import type { GeoProvider, GeoSearchOptions, GeoSearchResult } from './geo-provider.interface';

const NOMINATIM_URL  = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REV  = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT     = 'TransLogPro/1.0 (+https://translogpro.app)';
const REQUEST_TIMEOUT = 5_000;

/**
 * Bounding boxes by ISO 3166-1 alpha-2 (uppercase).
 * Format : [lngMin, latMax, lngMax, latMin]  →  Nominatim viewbox=x1,y1,x2,y2
 * Used to bias search results toward the tenant's operating country and to
 * reject obviously corrupted OSM data (point dans un autre pays malgre
 * country_code declare correct).
 */
export const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  CG: [11.0,   3.7, 18.7,  -5.1],
  CD: [12.2,   5.4, 31.3, -13.5],
  SN: [-17.5, 16.7, -11.4, 12.3],
  CI: [ -8.6, 10.7,  -2.5,  4.4],
  CM: [  8.5, 13.1,  16.2,  1.7],
  GA: [  8.7,  2.3,  14.5, -3.9],
  BJ: [  0.8, 12.4,   3.9,  6.2],
  TG: [ -0.1, 11.1,   1.8,  6.1],
  GH: [ -3.3, 11.2,   1.2,  4.7],
  NG: [  2.7, 14.0,  14.7,  4.3],
  ML: [ -4.2, 25.0,   4.3, 10.1],
  BF: [ -5.5, 15.1,   2.4,  9.4],
  GN: [-15.1, 12.7,  -7.6,  7.2],
  MR: [-17.1, 27.3,  -4.8, 14.7],
  MA: [-13.2, 36.1,  -1.0, 21.3],
  TN: [  7.5, 37.6,  11.6, 30.2],
  DZ: [ -8.7, 37.1,   9.0, 18.9],
  FR: [ -5.1, 51.1,   9.6, 42.3],
  BE: [  2.5, 51.5,   6.4, 49.5],
  CH: [  5.9, 47.8,  10.5, 45.8],
};

/**
 * Provider Nominatim/OpenStreetMap (gratuit, sans clef).
 * Toujours `configured = true` — sert de filet de derniere chance dans la
 * chaine de fallback du GeoService. Couverture africaine mediocre (raison
 * pour laquelle on prefere Google ou Mapbox quand disponibles).
 */
export class NominatimProvider implements GeoProvider {
  readonly name = 'nominatim' as const;
  private readonly log = new Logger(NominatimProvider.name);

  async isConfigured(): Promise<boolean> {
    return true; // toujours dispo, sans clef
  }

  async search(query: string, options?: GeoSearchOptions): Promise<GeoSearchResult[]> {
    const cc = options?.countryCode?.toUpperCase();
    const bbox = cc ? COUNTRY_BBOX[cc] : undefined;
    const limit = options?.limit ?? 5;

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('addressdetails', '1');
    if (cc) url.searchParams.set('countrycodes', cc.toLowerCase());
    if (bbox) {
      url.searchParams.set('viewbox', `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`);
      url.searchParams.set('bounded', '1');
    }

    const raw = await this.fetchJson(url.toString());
    return this.normalize(raw, cc);
  }

  async reverse(lat: number, lng: number, options?: GeoSearchOptions): Promise<GeoSearchResult | null> {
    const url = new URL(NOMINATIM_REV);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');

    const raw = await this.fetchJson(url.toString());
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const displayName = typeof r.display_name === 'string' ? r.display_name : '';
    const address = r.address as Record<string, unknown> | undefined;
    const countryCode = (typeof address?.country_code === 'string' ? address.country_code : '').toUpperCase();
    if (!displayName) return null;
    return { displayName: displayName.slice(0, 240), lat, lng, countryCode };
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':      USER_AGENT,
          'Accept':          'application/json',
          'Accept-Language': 'fr,en',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        this.log.warn(`Nominatim HTTP ${res.status}`);
        throw new Error(`Nominatim HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private normalize(raw: unknown, cc?: string): GeoSearchResult[] {
    if (!Array.isArray(raw)) return [];
    const bbox = cc ? COUNTRY_BBOX[cc] : undefined;
    const out: GeoSearchResult[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const displayName = typeof r.display_name === 'string' ? r.display_name : '';
      const address = r.address as Record<string, unknown> | undefined;
      const countryCode = (typeof address?.country_code === 'string' ? address.country_code : '').toUpperCase();
      if (
        !displayName ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;
      if (cc && countryCode && countryCode !== cc) continue;
      if (bbox) {
        const [lngMin, latMax, lngMax, latMin] = bbox;
        if (lng < lngMin - 2 || lng > lngMax + 2 || lat > latMax + 2 || lat < latMin - 2) continue;
      }
      out.push({ displayName: displayName.slice(0, 240), lat, lng, countryCode });
    }
    return out;
  }
}
