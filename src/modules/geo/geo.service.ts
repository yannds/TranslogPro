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
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import type { GeoProvider, GeoSearchResult } from './providers/geo-provider.interface';
import { COUNTRY_BBOX, NominatimProvider } from './providers/nominatim.provider';
import { GoogleGeocodingProvider } from './providers/google-geocoding.provider';
import { MapboxGeocodingProvider } from './providers/mapbox-geocoding.provider';

/** Valeurs autorisees pour `geo.provider` dans PlatformConfig. */
type GeoProviderPreference = 'auto' | 'google' | 'mapbox' | 'nominatim';

export type { GeoSearchResult };
export { COUNTRY_BBOX };

const CACHE_TTL_SEC   = 3_600;
const Q_MIN           = 3;
const Q_MAX           = 120;
const MAX_RESULTS     = 5;

/**
 * Service de geocoding orchestre par strategy multi-provider.
 *
 * Chaine de fallback (best-effort, qualite/cout decroissants) :
 *   1. Google Geocoding   (si platform/google-maps:API_KEY present dans Vault)
 *   2. Mapbox Geocoding   (si platform/mapbox:API_KEY present dans Vault)
 *   3. Nominatim/OSM      (toujours dispo, sans clef)
 *
 * Cache Redis 1h sur la clef (cc + query). Le cache est partage entre providers
 * — si Google a deja repondu pour "Av Foch, Brazzaville", la prochaine requete
 * (meme tenant ou autre) hit le cache sans appeler aucun provider.
 *
 * Reverse geocoding : meme chaine, pas de cache (resultat moins bornable a une
 * clef stable).
 */
@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);
  private readonly nominatim: NominatimProvider;
  private readonly google:    GoogleGeocodingProvider;
  private readonly mapbox:    MapboxGeocodingProvider;
  private readonly secrets:   ISecretService;
  private jsApiKeyCache:      { value: string | null; expiresAt: number } | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(SECRET_SERVICE) secrets: ISecretService,
    private readonly platformConfig?: PlatformConfigService,
  ) {
    this.nominatim = new NominatimProvider();
    this.google    = new GoogleGeocodingProvider(secrets);
    this.mapbox    = new MapboxGeocodingProvider(secrets);
    this.secrets   = secrets;
  }

  /**
   * Renvoie la clé Google Maps JavaScript API destinée au navigateur (Maps JS + Places).
   * Lue depuis Vault `platform/google-maps:JS_API_KEY`. Cache mémoire 5 min pour borner la
   * pression sur Vault (la clé est appelée par chaque ouverture de modale station).
   *
   * Sécurité : cette clé est une clé browser, restreinte par référent HTTP côté Google
   * Cloud Console. Elle est destinée à être visible dans la page HTML — sa fuite n'est
   * exploitable que depuis les domaines autorisés.
   */
  async getJsMapsApiKey(): Promise<string | null> {
    const now = Date.now();
    if (this.jsApiKeyCache && this.jsApiKeyCache.expiresAt > now) {
      return this.jsApiKeyCache.value;
    }
    let value: string | null = null;
    try {
      const v = await this.secrets.getSecret('platform/google-maps', 'JS_API_KEY');
      value = typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
    } catch {
      value = null;
    }
    this.jsApiKeyCache = { value, expiresAt: now + 5 * 60_000 };
    return value;
  }

  /**
   * Bounding box du pays sous forme `LatLngBoundsLiteral` consommable par Google
   * Maps JS (`{ north, south, east, west }`). Sert de **biais soft** sur Places
   * Autocomplete : les resultats dans la box remontent en tete sans bloquer
   * ceux situes a l'exterieur — l'utilisateur peut donc taper une adresse a
   * Paris pour un tenant base au Congo, elle sera toujours trouvee.
   *
   * Source : COUNTRY_BBOX du nominatim provider (deja maintenu pour le geocodage
   * server-side). Format source : [west, north, east, south].
   */
  getCountryBounds(countryCode: string | null | undefined):
    { north: number; south: number; east: number; west: number } | null {
    if (!countryCode) return null;
    const cc = countryCode.toUpperCase();
    const bbox = COUNTRY_BBOX[cc];
    if (!bbox) return null;
    const [west, north, east, south] = bbox;
    return { north, south, east, west };
  }

  async search(rawQuery: string, countryCode?: string): Promise<GeoSearchResult[]> {
    const q  = this.sanitize(rawQuery);
    const cc = countryCode?.trim().toUpperCase() || undefined;

    // v3 : cache key versionnee (v2 etait pre-multi-provider, contenu compatible
    // mais on bump pour purger les anciens hits potentiellement issus de
    // Nominatim seul avec mauvaises coords)
    const cacheKey = `geo:search:v3:${createHash('sha1').update(`${cc ?? ''}:${q}`).digest('hex')}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as GeoSearchResult[];
    } catch {
      // Redis down → fallback upstream
    }

    const providers = await this.resolveProviderChain();
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        const results = await provider.search(q, { countryCode: cc, limit: MAX_RESULTS });
        if (results.length > 0) {
          this.log.debug(`[Geo] search '${q}' (cc=${cc ?? '-'}) → ${results.length} via ${provider.name}`);
          this.redis.setex(cacheKey, CACHE_TTL_SEC, JSON.stringify(results))
            .catch(() => { /* non-critical */ });
          return results;
        }
        // 0 resultat : on tente le provider suivant (peut-etre meilleure couverture)
        this.log.debug(`[Geo] ${provider.name} → 0 result, fallback`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        this.log.warn(`[Geo] ${provider.name} error: ${lastError.message} — fallback next`);
      }
    }

    if (lastError) {
      throw new ServiceUnavailableException(`Geocoding indisponible : ${lastError.message}`);
    }
    return [];
  }

  /**
   * Reverse geocoding : retourne l'adresse la plus proche d'une coordonnee.
   * Utile pour confirmer "tu es bien sur le bon pin" apres drag manuel.
   */
  async reverse(lat: number, lng: number, countryCode?: string): Promise<GeoSearchResult | null> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat/lng must be finite numbers');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException('lat/lng out of range');
    }
    const cc = countryCode?.trim().toUpperCase() || undefined;

    const providers = await this.resolveProviderChain();
    for (const provider of providers) {
      try {
        const result = await provider.reverse(lat, lng, { countryCode: cc });
        if (result) return result;
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        this.log.warn(`[Geo] ${provider.name} reverse error: ${msg} — fallback`);
      }
    }
    return null;
  }

  /**
   * Construit la chaine de providers utilisable au moment de la requete.
   *
   * Honore la preference `geo.provider` du PlatformConfig :
   *  - 'auto'      → Google (si configured) → Mapbox (si configured) → Nominatim
   *  - 'google'    → Google seul (fallback Nominatim si non configured / erreur)
   *  - 'mapbox'    → Mapbox seul (fallback Nominatim)
   *  - 'nominatim' → Nominatim seul (force)
   *
   * Nominatim est toujours present en bout de chaine (sans clef, garanti dispo)
   * sauf si `geo.provider === 'nominatim'` ou que le user l'a force seul.
   */
  private async resolveProviderChain(): Promise<GeoProvider[]> {
    const preference = await this.getProviderPreference();

    if (preference === 'nominatim') {
      return [this.nominatim];
    }

    if (preference === 'google') {
      const chain: GeoProvider[] = [];
      if (await this.google.isConfigured()) chain.push(this.google);
      chain.push(this.nominatim); // fallback si Google indispo / non configure
      return chain;
    }

    if (preference === 'mapbox') {
      const chain: GeoProvider[] = [];
      if (await this.mapbox.isConfigured()) chain.push(this.mapbox);
      chain.push(this.nominatim);
      return chain;
    }

    // 'auto' (defaut) : best-effort en cascade
    const chain: GeoProvider[] = [];
    if (await this.google.isConfigured()) chain.push(this.google);
    if (await this.mapbox.isConfigured()) chain.push(this.mapbox);
    chain.push(this.nominatim);
    return chain;
  }

  private async getProviderPreference(): Promise<GeoProviderPreference> {
    if (!this.platformConfig) return 'auto';
    try {
      const value = await this.platformConfig.getString('geo.provider');
      if (value === 'auto' || value === 'google' || value === 'mapbox' || value === 'nominatim') {
        return value;
      }
      return 'auto';
    } catch {
      return 'auto';
    }
  }

  private sanitize(input: unknown): string {
    if (typeof input !== 'string') {
      throw new BadRequestException('q must be a string');
    }
    const cleaned = input.replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < Q_MIN || cleaned.length > Q_MAX) {
      throw new BadRequestException(`q length must be ${Q_MIN}..${Q_MAX}`);
    }
    return cleaned;
  }
}
