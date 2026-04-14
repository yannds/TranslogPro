/**
 * CityConfig — Référentiel de villes par pays/tenant
 *
 * En production : GET /api/tenant/cities?country=CG
 * Le tenant stocke son pays dans TenantBrand / TenantBusinessConfig.
 * Ce fichier définit les types et le seed statique de fallback.
 *
 * Pays couverts :
 *   CG  — République du Congo (Brazzaville)  [défaut]
 *   CD  — République Démocratique du Congo
 *   GA  — Gabon
 *   AO  — Angola
 *   CM  — Cameroun
 *   CF  — République Centrafricaine
 *   SN  — Sénégal
 *   NG  — Nigéria (inter-état)
 */

export interface City {
  id:         string;
  code:       string;    // ex. BZV
  name:       string;    // nom officiel
  country:    string;    // ISO 3166-1 alpha-2
  region?:    string;
  isHub:      boolean;   // gare principale
  coords?: {
    lat: number;
    lng: number;
  };
  /** Traductions du nom (si différent en d'autres langues) */
  namei18n?: Partial<Record<string, string>>;
}

export interface Route {
  id:          string;
  fromCityId:  string;
  toCityId:    string;
  distanceKm:  number;
  durationMin: number;   // durée moyenne
  isInterstate: boolean;
}

// ─── Villes par pays ──────────────────────────────────────────────────────────

export const CITIES_BY_COUNTRY: Record<string, City[]> = {

  // ── République du Congo (défaut) ──────────────────────────────────────────
  CG: [
    { id: 'bzv',  code: 'BZV', name: 'Brazzaville',    country: 'CG', isHub: true,  coords: { lat: -4.2661, lng: 15.2832 } },
    { id: 'pnr',  code: 'PNR', name: 'Pointe-Noire',   country: 'CG', isHub: true,  coords: { lat: -4.7731, lng: 11.8635 } },
    { id: 'dol',  code: 'DOL', name: 'Dolisie',         country: 'CG', isHub: false, coords: { lat: -4.1984, lng: 12.6667 } },
    { id: 'nky',  code: 'NKY', name: 'N\'Kayi',         country: 'CG', isHub: false, coords: { lat: -4.1733, lng: 13.2833 } },
    { id: 'imp',  code: 'IMP', name: 'Impfondo',        country: 'CG', isHub: false, coords: { lat: 1.6167,  lng: 18.0667 } },
    { id: 'oue',  code: 'OUE', name: 'Ouesso',          country: 'CG', isHub: false, coords: { lat: 1.6167,  lng: 16.05   } },
    { id: 'owa',  code: 'OWA', name: 'Owando',          country: 'CG', isHub: false, coords: { lat: -0.4833, lng: 15.9    } },
    { id: 'mos',  code: 'MOS', name: 'Mossendjo',       country: 'CG', isHub: false, coords: { lat: -2.95,   lng: 12.7167 } },
    { id: 'sib',  code: 'SIB', name: 'Sibiti',          country: 'CG', isHub: false, coords: { lat: -3.6833, lng: 13.35   } },
    { id: 'gam',  code: 'GAM', name: 'Gamboma',         country: 'CG', isHub: false, coords: { lat: -1.8667, lng: 15.8667 } },
    { id: 'kin',  code: 'KIN', name: 'Kinkala',         country: 'CG', isHub: false, coords: { lat: -4.3583, lng: 14.7556 } },
    { id: 'mad',  code: 'MAD', name: 'Madingou',        country: 'CG', isHub: false, coords: { lat: -4.15,   lng: 13.55   } },
    { id: 'loo',  code: 'LOO', name: 'Loubomo',         country: 'CG', isHub: false, coords: { lat: -4.2,    lng: 12.7    } },
    { id: 'djm',  code: 'DJM', name: 'Djambala',        country: 'CG', isHub: false, coords: { lat: -2.5167, lng: 14.75   } },
  ],

  // ── RDC ───────────────────────────────────────────────────────────────────
  CD: [
    { id: 'fih',  code: 'FIH', name: 'Kinshasa',        country: 'CD', isHub: true,  coords: { lat: -4.3217, lng: 15.3125 } },
    { id: 'flb',  code: 'FLB', name: 'Lubumbashi',      country: 'CD', isHub: true,  coords: { lat: -11.6647, lng: 27.4795 } },
    { id: 'mba',  code: 'MBA', name: 'Mbandaka',        country: 'CD', isHub: false, coords: { lat: 0.0489,  lng: 18.2617 } },
  ],

  // ── Gabon ─────────────────────────────────────────────────────────────────
  GA: [
    { id: 'lbv',  code: 'LBV', name: 'Libreville',      country: 'GA', isHub: true,  coords: { lat: 0.4162,  lng: 9.4673  } },
    { id: 'pog',  code: 'POG', name: 'Port-Gentil',     country: 'GA', isHub: true,  coords: { lat: -0.7193, lng: 8.7815  } },
    { id: 'fco',  code: 'FCO', name: 'Franceville',     country: 'GA', isHub: false, coords: { lat: -1.6333, lng: 13.5833 } },
  ],

  // ── Cameroun ──────────────────────────────────────────────────────────────
  CM: [
    { id: 'yao',  code: 'YAO', name: 'Yaoundé',         country: 'CM', isHub: true,  coords: { lat: 3.8480,  lng: 11.5021 } },
    { id: 'dla',  code: 'DLA', name: 'Douala',          country: 'CM', isHub: true,  coords: { lat: 4.0511,  lng: 9.7679  } },
  ],

  // ── Angola ────────────────────────────────────────────────────────────────
  AO: [
    { id: 'lua',  code: 'LUA', name: 'Luanda',          country: 'AO', isHub: true,  coords: { lat: -8.8370, lng: 13.2343 } },
  ],

  // ── Sénégal ───────────────────────────────────────────────────────────────
  SN: [
    { id: 'dkr',  code: 'DKR', name: 'Dakar',           country: 'SN', isHub: true,  coords: { lat: 14.7167, lng: -17.4677 } },
    { id: 'slk',  code: 'SLK', name: 'Saint-Louis',     country: 'SN', isHub: false, coords: { lat: 16.0183, lng: -16.4897 } },
    { id: 'ths',  code: 'THS', name: 'Thiès',           country: 'SN', isHub: false, coords: { lat: 14.7889, lng: -16.9261 } },
    { id: 'klk',  code: 'KLK', name: 'Kaolack',         country: 'SN', isHub: false, coords: { lat: 14.1383, lng: -16.0747 } },
    { id: 'zig',  code: 'ZIG', name: 'Ziguinchor',      country: 'SN', isHub: false, coords: { lat: 12.5681, lng: -16.2719 } },
    { id: 'tba',  code: 'TBA', name: 'Tambacounda',     country: 'SN', isHub: false, coords: { lat: 13.7703, lng: -13.6673 } },
  ],
};

/** Résolution d'une ville par son ID */
export function getCityById(id: string): City | undefined {
  return Object.values(CITIES_BY_COUNTRY).flat().find(c => c.id === id);
}

/** Liste des villes pour un pays donné + destinations inter-états optionnelles */
export function getCitiesForTenant(countryCode: string, includeInterstate = true): City[] {
  const local = CITIES_BY_COUNTRY[countryCode] ?? CITIES_BY_COUNTRY['CG'];
  if (!includeInterstate) return local;
  // Ajoute les capitales des pays voisins comme destinations inter-états
  const hubs = Object.values(CITIES_BY_COUNTRY)
    .flat()
    .filter(c => c.country !== countryCode && c.isHub);
  return [...local, ...hubs];
}

/** Pays supportés (pour le tenant config) */
export const SUPPORTED_COUNTRIES = [
  { code: 'CG', name: 'République du Congo', flag: '🇨🇬', defaultLang: 'fr' as const },
  { code: 'CD', name: 'RD Congo',            flag: '🇨🇩', defaultLang: 'fr' as const },
  { code: 'GA', name: 'Gabon',               flag: '🇬🇦', defaultLang: 'fr' as const },
  { code: 'CM', name: 'Cameroun',            flag: '🇨🇲', defaultLang: 'fr' as const },
  { code: 'AO', name: 'Angola',              flag: '🇦🇴', defaultLang: 'pt' as const },
  { code: 'SN', name: 'Sénégal',             flag: '🇸🇳', defaultLang: 'wo' as const },
];
