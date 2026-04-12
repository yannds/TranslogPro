import { Injectable, Logger, Inject } from '@nestjs/common';
import axios from 'axios';
import { IWeatherService, WeatherCondition } from './interfaces/weather.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

const OWM_BASE    = 'https://api.openweathermap.org/data/2.5/weather';
const CACHE_TTL   = 10 * 60 * 1_000; // 10 min — OWM free tier limit = 1 000 req/day
const COORD_ROUND = 2; // arrondi lat/lng pour clé de cache (≈ 1km précision)

/**
 * OpenWeatherMapService — implémentation de IWeatherService.
 *
 * Sécurité :
 *   - API key lue depuis Vault : "platform/openweathermap" → { API_KEY }
 *   - Cache mémoire LRU par coordonnées (arrondi 0.01°) — 10min TTL
 *   - Fallback gracieux : si OWM échoue, retourne null (Smart Display
 *     affiche "Météo indisponible" au lieu de bloquer la page)
 *   - timeout 5s — ne bloque jamais la transaction WebSocket GPS
 */
@Injectable()
export class OpenWeatherMapService implements IWeatherService {
  private readonly logger   = new Logger(OpenWeatherMapService.name);
  private apiKey: string | null = null;
  private keyCachedAt = 0;
  private readonly KEY_TTL  = 5  * 60 * 1_000;

  // Cache météo : clé = "lat:lng" arrondis, valeur = résultat + timestamp
  private readonly weatherCache = new Map<string, { data: WeatherCondition; fetchedAt: number }>();

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async getCurrentWeather(lat: number, lng: number): Promise<WeatherCondition> {
    const cacheKey = this.cacheKey(lat, lng);
    const cached   = this.weatherCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }

    const key = await this.getApiKey();

    try {
      const { data } = await axios.get(OWM_BASE, {
        params: { lat, lon: lng, appid: key, units: 'metric', lang: 'fr' },
        timeout: 5_000,
      });

      const condition: WeatherCondition = {
        stationId:    `${lat},${lng}`,
        description:  data.weather?.[0]?.description ?? 'Inconnu',
        icon:         data.weather?.[0]?.icon         ?? '01d',
        temperatureC: Math.round(data.main?.temp     ?? 0),
        humidity:     data.main?.humidity             ?? 0,
        windSpeedKmh: Math.round((data.wind?.speed   ?? 0) * 3.6),
        isRainy:      [200, 300, 500, 600].some(g =>
          Math.floor((data.weather?.[0]?.id ?? 0) / 100) === Math.floor(g / 100),
        ),
        fetchedAt: new Date(),
      };

      this.weatherCache.set(cacheKey, { data: condition, fetchedAt: Date.now() });
      this.logger.debug(`[Weather] ${condition.description} ${condition.temperatureC}°C @ ${lat},${lng}`);
      return condition;

    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${err.message}`
        : String(err);
      this.logger.warn(`[Weather] OWM fetch failed: ${msg} — returning fallback`);

      // Fallback gracieux — ne bloque jamais le display
      return {
        stationId:    `${lat},${lng}`,
        description:  'Météo indisponible',
        icon:         '01d',
        temperatureC: 0,
        humidity:     0,
        windSpeedKmh: 0,
        isRainy:      false,
        fetchedAt:    new Date(),
      };
    }
  }

  private async getApiKey(): Promise<string> {
    const now = Date.now();
    if (this.apiKey && now - this.keyCachedAt < this.KEY_TTL) return this.apiKey;
    const secret = await this.secretService.getSecretObject<{ API_KEY: string }>(
      'platform/openweathermap',
    );
    if (!secret.API_KEY) throw new Error('OpenWeatherMap API_KEY manquant dans Vault');
    this.apiKey      = secret.API_KEY;
    this.keyCachedAt = now;
    return this.apiKey;
  }

  private cacheKey(lat: number, lng: number): string {
    return `${lat.toFixed(COORD_ROUND)}:${lng.toFixed(COORD_ROUND)}`;
  }
}
