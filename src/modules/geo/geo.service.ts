import {
  Injectable,
  Inject,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { createHash } from 'crypto';
import { REDIS_CLIENT } from '../../infrastructure/eventbus/redis-publisher.service';

export interface GeoSearchResult {
  displayName: string;
  lat:         number;
  lng:         number;
  countryCode: string;
}

const NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT      = 'TransLogPro/1.0 (+https://translogpro.app)';
const MAX_RESULTS     = 5;
const CACHE_TTL_SEC   = 3_600;
const REQUEST_TIMEOUT = 5_000;
const Q_MIN           = 3;
const Q_MAX           = 120;

/**
 * Bounding boxes by ISO 3166-1 alpha-2 (uppercase).
 * Format : [lngMin, latMax, lngMax, latMin]  →  Nominatim viewbox=x1,y1,x2,y2
 * Used to bias search results toward the tenant's operating country without
 * excluding international destinations (bounded=0, the Nominatim default).
 */
export const COUNTRY_BBOX: Record<string, [number, number, number, number]> = {
  CG: [11.0,   3.7, 18.7,  -5.1],   // Republic of Congo
  CD: [12.2,   5.4, 31.3, -13.5],   // DR Congo
  SN: [-17.5, 16.7, -11.4, 12.3],   // Senegal
  CI: [ -8.6, 10.7,  -2.5,  4.4],   // Côte d'Ivoire
  CM: [  8.5, 13.1,  16.2,  1.7],   // Cameroon
  GA: [  8.7,  2.3,  14.5, -3.9],   // Gabon
  BJ: [  0.8, 12.4,   3.9,  6.2],   // Benin
  TG: [ -0.1, 11.1,   1.8,  6.1],   // Togo
  GH: [ -3.3, 11.2,   1.2,  4.7],   // Ghana
  NG: [  2.7, 14.0,  14.7,  4.3],   // Nigeria
  ML: [ -4.2, 25.0,   4.3, 10.1],   // Mali
  BF: [ -5.5, 15.1,   2.4,  9.4],   // Burkina Faso
  GN: [-15.1, 12.7,  -7.6,  7.2],   // Guinea
  MR: [-17.1, 27.3,  -4.8, 14.7],   // Mauritania
  MA: [-13.2, 36.1,  -1.0, 21.3],   // Morocco
  TN: [  7.5, 37.6,  11.6, 30.2],   // Tunisia
  DZ: [ -8.7, 37.1,   9.0, 18.9],   // Algeria
  FR: [ -5.1, 51.1,   9.6, 42.3],   // France
  BE: [  2.5, 51.5,   6.4, 49.5],   // Belgium
  CH: [  5.9, 47.8,  10.5, 45.8],   // Switzerland
};

@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async search(rawQuery: string, countryCode?: string): Promise<GeoSearchResult[]> {
    const q = this.sanitize(rawQuery);
    const cc = countryCode?.trim().toUpperCase() || undefined;
    const bbox = cc ? COUNTRY_BBOX[cc] : undefined;

    // v2: cache key versionnée pour invalider les anciens résultats sans countrycodes
    const cacheKey = `geo:search:v2:${createHash('sha1').update(`${cc ?? ''}:${q}`).digest('hex')}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as GeoSearchResult[];
    } catch {
      // Redis down → fallback upstream
    }

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(MAX_RESULTS));
    url.searchParams.set('addressdetails', '1');
    // Restrict to tenant's operating country (prevents returning results from
    // neighbouring countries for same-name addresses, e.g. Kintélé CG vs GA).
    if (cc) url.searchParams.set('countrycodes', cc.toLowerCase());
    if (bbox) url.searchParams.set('viewbox', `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let raw: unknown;
    try {
      const res = await fetch(url.toString(), {
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
        throw new ServiceUnavailableException('Geocoding upstream unavailable');
      }
      raw = await res.json();
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      const msg = (e as Error).message ?? String(e);
      this.log.warn(`Nominatim error: ${msg}`);
      throw new ServiceUnavailableException(`Geocoding indisponible : ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    const results = this.normalize(raw, cc);
    this.redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(results))
      .catch(() => { /* non-critical */ });
    return results;
  }

  private sanitize(input: unknown): string {
    if (typeof input !== 'string') {
      throw new BadRequestException('q must be a string');
    }
    // Strip control chars, collapse whitespace
    const cleaned = input.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < Q_MIN || cleaned.length > Q_MAX) {
      throw new BadRequestException(`q length must be ${Q_MIN}..${Q_MAX}`);
    }
    return cleaned;
  }

  private normalize(raw: unknown, cc?: string): GeoSearchResult[] {
    if (!Array.isArray(raw)) return [];
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
      // Defense-in-depth: drop results from a different country even if Nominatim
      // returns them despite the countrycodes= filter.
      if (cc && countryCode && countryCode !== cc) continue;
      out.push({ displayName: displayName.slice(0, 240), lat, lng, countryCode });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
}
