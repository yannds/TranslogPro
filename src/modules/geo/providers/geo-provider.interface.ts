/**
 * Contrat commun aux providers de geocoding (forward) et reverse-geocoding.
 *
 * Forward  : adresse texte → liste de resultats avec coordonnees
 * Reverse  : coordonnees → adresse texte la plus proche
 *
 * Chaque provider concret (Google, Mapbox, Nominatim) doit :
 *  - exposer un nom stable (utilise pour le logging et le tracing)
 *  - savoir dire s'il est `configured` (clef API presente, etc.)
 *  - normaliser ses resultats au format `GeoSearchResult` ci-dessous
 *
 * Le `GeoService` orchestre les providers en chaine de fallback :
 *   Google (si configured) → Mapbox (si configured) → Nominatim (toujours)
 */

export interface GeoSearchResult {
  /** Adresse formatee humaine, deja localisee (fr/en) */
  displayName: string;
  lat:         number;
  lng:         number;
  /** ISO 3166-1 alpha-2, uppercase */
  countryCode: string;
}

export interface GeoSearchOptions {
  /** ISO 3166-1 alpha-2 — biais geographique pour ameliorer la pertinence */
  countryCode?: string;
  /** Limite stricte de resultats (defaut : MAX_RESULTS du service) */
  limit?: number;
}

export interface GeoProvider {
  /** Nom stable du provider (telemetry, logs) */
  readonly name: 'google' | 'mapbox' | 'nominatim';

  /** Vrai si le provider a ses credentials/configuration et peut servir une requete */
  isConfigured(): Promise<boolean>;

  /** Forward geocoding : adresse → coordonnees */
  search(query: string, options?: GeoSearchOptions): Promise<GeoSearchResult[]>;

  /**
   * Reverse geocoding : coordonnees → adresse la plus proche.
   * Retourne null si rien de pertinent.
   */
  reverse(lat: number, lng: number, options?: GeoSearchOptions): Promise<GeoSearchResult | null>;
}
