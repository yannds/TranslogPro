export const WEATHER_SERVICE = 'IWeatherService';

export interface WeatherCondition {
  stationId:       string;
  description:     string;   // ex: "Nuageux", "Ensoleillé", "Pluie modérée"
  icon:            string;   // code OpenWeatherMap (ex: "10d")
  temperatureC:    number;
  humidity:        number;   // %
  windSpeedKmh:    number;
  isRainy:         boolean;  // helper pour alertes conducteur
  fetchedAt:       Date;
}

export interface IWeatherService {
  /**
   * Retourne la météo actuelle à destination d'un trajet.
   * Utilise les coordonnées de la Station (lat/lng depuis GeoJSON).
   * Cache interne 10min — ne pas appeler à chaque GPS update.
   */
  getCurrentWeather(lat: number, lng: number): Promise<WeatherCondition>;
}
