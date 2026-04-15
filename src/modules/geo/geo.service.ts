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
}

const NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT      = 'TransLogPro/1.0 (+https://translogpro.app)';
const MAX_RESULTS     = 5;
const CACHE_TTL_SEC   = 3_600;
const REQUEST_TIMEOUT = 5_000;
const Q_MIN           = 3;
const Q_MAX           = 120;

@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async search(rawQuery: string): Promise<GeoSearchResult[]> {
    const q = this.sanitize(rawQuery);

    const cacheKey = `geo:search:${createHash('sha1').update(q).digest('hex')}`;
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
    url.searchParams.set('addressdetails', '0');

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
      this.log.warn(`Nominatim error: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Geocoding upstream unavailable');
    } finally {
      clearTimeout(timer);
    }

    const results = this.normalize(raw);
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

  private normalize(raw: unknown): GeoSearchResult[] {
    if (!Array.isArray(raw)) return [];
    const out: GeoSearchResult[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const displayName = typeof r.display_name === 'string' ? r.display_name : '';
      if (
        !displayName ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) continue;
      out.push({ displayName: displayName.slice(0, 240), lat, lng });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }
}
