/**
 * useWeather — Données météo pour une ville
 *
 * En production : GET /api/weather?cityCode=PNR
 * (NestJS proxy vers un service météo externe — pas d'appel direct navigateur
 *  pour éviter d'exposer une clé API)
 *
 * Simule des données réalistes pour les villes du Congo / Sénégal.
 */

import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WeatherCondition =
  | 'sunny'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rainy'
  | 'stormy'
  | 'foggy'
  | 'windy';

export interface WeatherData {
  cityCode:    string;
  cityName:    string;
  tempC:       number;
  feelsLikeC:  number;
  humidity:    number;   // %
  windKmh:     number;
  condition:   WeatherCondition;
  updatedAt:   Date;
}

/** Icône SVG inline par condition (pas d'emoji pour compatibilité affichage TV) */
export const WEATHER_ICONS: Record<WeatherCondition, string> = {
  sunny:         '☀',
  partly_cloudy: '⛅',
  cloudy:        '☁',
  rainy:         '🌧',
  stormy:        '⛈',
  foggy:         '🌫',
  windy:         '💨',
};

// ─── Données de démo par ville ────────────────────────────────────────────────

const MOCK_WEATHER: Record<string, WeatherData> = {
  BZV: { cityCode: 'BZV', cityName: 'Brazzaville',  tempC: 27, feelsLikeC: 30, humidity: 78, windKmh: 12, condition: 'partly_cloudy', updatedAt: new Date() },
  PNR: { cityCode: 'PNR', cityName: 'Pointe-Noire', tempC: 28, feelsLikeC: 31, humidity: 82, windKmh: 15, condition: 'partly_cloudy', updatedAt: new Date() },
  DOL: { cityCode: 'DOL', cityName: 'Dolisie',       tempC: 24, feelsLikeC: 26, humidity: 85, windKmh: 8,  condition: 'rainy',         updatedAt: new Date() },
  OUE: { cityCode: 'OUE', cityName: 'Ouesso',        tempC: 26, feelsLikeC: 29, humidity: 90, windKmh: 6,  condition: 'cloudy',        updatedAt: new Date() },
  OWA: { cityCode: 'OWA', cityName: 'Owando',        tempC: 25, feelsLikeC: 27, humidity: 80, windKmh: 10, condition: 'sunny',         updatedAt: new Date() },
  DKR: { cityCode: 'DKR', cityName: 'Dakar',         tempC: 30, feelsLikeC: 34, humidity: 70, windKmh: 20, condition: 'sunny',         updatedAt: new Date() },
  SLK: { cityCode: 'SLK', cityName: 'Saint-Louis',   tempC: 32, feelsLikeC: 35, humidity: 60, windKmh: 25, condition: 'windy',         updatedAt: new Date() },
  ZIG: { cityCode: 'ZIG', cityName: 'Ziguinchor',    tempC: 31, feelsLikeC: 33, humidity: 75, windKmh: 8,  condition: 'partly_cloudy', updatedAt: new Date() },
  LBV: { cityCode: 'LBV', cityName: 'Libreville',    tempC: 26, feelsLikeC: 29, humidity: 88, windKmh: 10, condition: 'rainy',         updatedAt: new Date() },
  FIH: { cityCode: 'FIH', cityName: 'Kinshasa',      tempC: 26, feelsLikeC: 29, humidity: 80, windKmh: 12, condition: 'cloudy',        updatedAt: new Date() },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWeather(cityCode: string | undefined): {
  weather:   WeatherData | null;
  loading:   boolean;
  error:     string | null;
} {
  const [weather, setWeather]   = useState<WeatherData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    if (!cityCode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    // Simule latence API
    const t = setTimeout(() => {
      const data = MOCK_WEATHER[cityCode.toUpperCase()];
      if (data) {
        setWeather(data);
        setError(null);
      } else {
        setError(`No weather data for ${cityCode}`);
      }
      setLoading(false);
    }, 400);
    return () => clearTimeout(t);
  }, [cityCode]);

  return { weather, loading, error };
}

// ─── Multi-city hook (pour ticker météo) ────────────────────────────────────

/**
 * Retourne la météo pour plusieurs villes en une seule passe.
 * Les cityCodes sont dédupliqués automatiquement.
 */
export function useWeatherMulti(cityCodes: string[]): WeatherData[] {
  const [data, setData] = useState<WeatherData[]>([]);

  useEffect(() => {
    const unique = [...new Set(cityCodes.map(c => c.toUpperCase()))];
    const results: WeatherData[] = [];
    for (const code of unique) {
      const w = MOCK_WEATHER[code];
      if (w) results.push(w);
    }
    setData(results);
  }, [cityCodes.join(',')]);

  return data;
}
