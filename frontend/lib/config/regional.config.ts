/**
 * regional.config.ts — Référentiel pays, fuseaux horaires et devises
 *
 * Source de vérité frontend pour :
 *   - Liste des pays supportés (select + onboarding)
 *   - Mapping pays → timezone / devise / langue par défaut
 *   - Liste des fuseaux horaires (filtrés par pays)
 *   - Liste des formats de date
 */

// ─── Pays ────────────────────────────────────────────────────────────────────

export interface CountryOption {
  code:        string;  // ISO 3166-1 alpha-2
  name:        string;
  flag:        string;
  defaultLang: string;  // ISO 639-1
  timezone:    string;  // IANA TZ par défaut
  currency:    string;  // ISO 4217 par défaut
}

export const COUNTRIES: CountryOption[] = [
  // ── Afrique Centrale (CEMAC) ──
  { code: 'CG', name: 'République du Congo',     flag: '🇨🇬', defaultLang: 'fr', timezone: 'Africa/Brazzaville',  currency: 'XAF' },
  { code: 'CD', name: 'RD Congo',                flag: '🇨🇩', defaultLang: 'fr', timezone: 'Africa/Kinshasa',     currency: 'CDF' },
  { code: 'CM', name: 'Cameroun',                flag: '🇨🇲', defaultLang: 'fr', timezone: 'Africa/Douala',       currency: 'XAF' },
  { code: 'GA', name: 'Gabon',                   flag: '🇬🇦', defaultLang: 'fr', timezone: 'Africa/Libreville',   currency: 'XAF' },
  { code: 'TD', name: 'Tchad',                   flag: '🇹🇩', defaultLang: 'fr', timezone: 'Africa/Ndjamena',     currency: 'XAF' },
  { code: 'CF', name: 'Centrafrique',            flag: '🇨🇫', defaultLang: 'fr', timezone: 'Africa/Bangui',       currency: 'XAF' },
  { code: 'GQ', name: 'Guinée équatoriale',      flag: '🇬🇶', defaultLang: 'fr', timezone: 'Africa/Malabo',       currency: 'XAF' },
  { code: 'ST', name: 'São Tomé-et-Príncipe',    flag: '🇸🇹', defaultLang: 'fr', timezone: 'Africa/Sao_Tome',     currency: 'STN' },
  // ── Afrique de l'Ouest (UEMOA + autres) ──
  { code: 'SN', name: 'Sénégal',                 flag: '🇸🇳', defaultLang: 'fr', timezone: 'Africa/Dakar',        currency: 'XOF' },
  { code: 'CI', name: 'Côte d\'Ivoire',          flag: '🇨🇮', defaultLang: 'fr', timezone: 'Africa/Abidjan',      currency: 'XOF' },
  { code: 'ML', name: 'Mali',                    flag: '🇲🇱', defaultLang: 'fr', timezone: 'Africa/Bamako',       currency: 'XOF' },
  { code: 'BF', name: 'Burkina Faso',            flag: '🇧🇫', defaultLang: 'fr', timezone: 'Africa/Ouagadougou',  currency: 'XOF' },
  { code: 'NE', name: 'Niger',                   flag: '🇳🇪', defaultLang: 'fr', timezone: 'Africa/Niamey',       currency: 'XOF' },
  { code: 'TG', name: 'Togo',                    flag: '🇹🇬', defaultLang: 'fr', timezone: 'Africa/Lome',         currency: 'XOF' },
  { code: 'BJ', name: 'Bénin',                   flag: '🇧🇯', defaultLang: 'fr', timezone: 'Africa/Porto-Novo',   currency: 'XOF' },
  { code: 'GW', name: 'Guinée-Bissau',           flag: '🇬🇼', defaultLang: 'fr', timezone: 'Africa/Bissau',       currency: 'XOF' },
  { code: 'GN', name: 'Guinée',                  flag: '🇬🇳', defaultLang: 'fr', timezone: 'Africa/Conakry',      currency: 'GNF' },
  { code: 'SL', name: 'Sierra Leone',            flag: '🇸🇱', defaultLang: 'en', timezone: 'Africa/Freetown',     currency: 'SLL' },
  { code: 'LR', name: 'Liberia',                 flag: '🇱🇷', defaultLang: 'en', timezone: 'Africa/Monrovia',     currency: 'LRD' },
  { code: 'NG', name: 'Nigeria',                 flag: '🇳🇬', defaultLang: 'en', timezone: 'Africa/Lagos',        currency: 'NGN' },
  { code: 'GH', name: 'Ghana',                   flag: '🇬🇭', defaultLang: 'en', timezone: 'Africa/Accra',        currency: 'GHS' },
  { code: 'GM', name: 'Gambie',                  flag: '🇬🇲', defaultLang: 'en', timezone: 'Africa/Banjul',       currency: 'GMD' },
  { code: 'CV', name: 'Cap-Vert',                flag: '🇨🇻', defaultLang: 'fr', timezone: 'Atlantic/Cape_Verde', currency: 'CVE' },
  // ── Afrique de l'Est ──
  { code: 'RW', name: 'Rwanda',                  flag: '🇷🇼', defaultLang: 'fr', timezone: 'Africa/Kigali',       currency: 'RWF' },
  { code: 'BI', name: 'Burundi',                 flag: '🇧🇮', defaultLang: 'fr', timezone: 'Africa/Bujumbura',    currency: 'BIF' },
  { code: 'KE', name: 'Kenya',                   flag: '🇰🇪', defaultLang: 'en', timezone: 'Africa/Nairobi',      currency: 'KES' },
  { code: 'UG', name: 'Ouganda',                 flag: '🇺🇬', defaultLang: 'en', timezone: 'Africa/Kampala',      currency: 'UGX' },
  { code: 'ET', name: 'Éthiopie',                flag: '🇪🇹', defaultLang: 'en', timezone: 'Africa/Addis_Ababa',  currency: 'ETB' },
  { code: 'DJ', name: 'Djibouti',                flag: '🇩🇯', defaultLang: 'fr', timezone: 'Africa/Djibouti',     currency: 'DJF' },
  // ── Afrique du Nord ──
  { code: 'MA', name: 'Maroc',                   flag: '🇲🇦', defaultLang: 'fr', timezone: 'Africa/Casablanca',   currency: 'MAD' },
  { code: 'TN', name: 'Tunisie',                 flag: '🇹🇳', defaultLang: 'fr', timezone: 'Africa/Tunis',        currency: 'TND' },
  { code: 'DZ', name: 'Algérie',                 flag: '🇩🇿', defaultLang: 'fr', timezone: 'Africa/Algiers',      currency: 'DZD' },
  // ── Afrique Australe ──
  { code: 'AO', name: 'Angola',                  flag: '🇦🇴', defaultLang: 'fr', timezone: 'Africa/Luanda',       currency: 'AOA' },
  // ── International ──
  { code: 'FR', name: 'France',                  flag: '🇫🇷', defaultLang: 'fr', timezone: 'Europe/Paris',        currency: 'EUR' },
  { code: 'BE', name: 'Belgique',                flag: '🇧🇪', defaultLang: 'fr', timezone: 'Europe/Brussels',     currency: 'EUR' },
  { code: 'CN', name: 'Chine',                   flag: '🇨🇳', defaultLang: 'en', timezone: 'Asia/Shanghai',       currency: 'CNY' },
];

/** Lookup rapide pays par code */
export function getCountry(code: string): CountryOption | undefined {
  return COUNTRIES.find(c => c.code === code);
}

// ─── Fuseaux horaires ────────────────────────────────────────────────────────

export interface TimezoneOption {
  value:     string;  // IANA TZ
  label:     string;
  countries: string[];  // ISO alpha-2 codes
}

export const TIMEZONES: TimezoneOption[] = [
  // Afrique Centrale (WAT / UTC+1)
  { value: 'Africa/Brazzaville',  label: 'Brazzaville (UTC+1)',    countries: ['CG'] },
  { value: 'Africa/Kinshasa',     label: 'Kinshasa (UTC+1)',       countries: ['CD'] },
  { value: 'Africa/Lubumbashi',   label: 'Lubumbashi (UTC+2)',     countries: ['CD'] },
  { value: 'Africa/Douala',       label: 'Douala (UTC+1)',         countries: ['CM'] },
  { value: 'Africa/Libreville',   label: 'Libreville (UTC+1)',     countries: ['GA'] },
  { value: 'Africa/Ndjamena',     label: 'N\'Djamena (UTC+1)',     countries: ['TD'] },
  { value: 'Africa/Bangui',       label: 'Bangui (UTC+1)',         countries: ['CF'] },
  { value: 'Africa/Malabo',       label: 'Malabo (UTC+1)',         countries: ['GQ'] },
  { value: 'Africa/Sao_Tome',     label: 'São Tomé (UTC+0)',       countries: ['ST'] },
  // Afrique de l'Ouest (GMT / UTC+0 ou WAT / UTC+1)
  { value: 'Africa/Dakar',        label: 'Dakar (UTC+0)',          countries: ['SN'] },
  { value: 'Africa/Abidjan',      label: 'Abidjan (UTC+0)',        countries: ['CI'] },
  { value: 'Africa/Bamako',       label: 'Bamako (UTC+0)',         countries: ['ML'] },
  { value: 'Africa/Ouagadougou',  label: 'Ouagadougou (UTC+0)',    countries: ['BF'] },
  { value: 'Africa/Niamey',       label: 'Niamey (UTC+1)',         countries: ['NE'] },
  { value: 'Africa/Lome',         label: 'Lomé (UTC+0)',           countries: ['TG'] },
  { value: 'Africa/Porto-Novo',   label: 'Porto-Novo (UTC+1)',     countries: ['BJ'] },
  { value: 'Africa/Bissau',       label: 'Bissau (UTC+0)',         countries: ['GW'] },
  { value: 'Africa/Conakry',      label: 'Conakry (UTC+0)',        countries: ['GN'] },
  { value: 'Africa/Freetown',     label: 'Freetown (UTC+0)',       countries: ['SL'] },
  { value: 'Africa/Monrovia',     label: 'Monrovia (UTC+0)',       countries: ['LR'] },
  { value: 'Africa/Lagos',        label: 'Lagos (UTC+1)',          countries: ['NG'] },
  { value: 'Africa/Accra',        label: 'Accra (UTC+0)',          countries: ['GH'] },
  { value: 'Africa/Banjul',       label: 'Banjul (UTC+0)',         countries: ['GM'] },
  { value: 'Atlantic/Cape_Verde', label: 'Cap-Vert (UTC-1)',       countries: ['CV'] },
  // Afrique de l'Est (EAT / UTC+3)
  { value: 'Africa/Kigali',       label: 'Kigali (UTC+2)',         countries: ['RW'] },
  { value: 'Africa/Bujumbura',    label: 'Bujumbura (UTC+2)',      countries: ['BI'] },
  { value: 'Africa/Nairobi',      label: 'Nairobi (UTC+3)',        countries: ['KE'] },
  { value: 'Africa/Kampala',      label: 'Kampala (UTC+3)',        countries: ['UG'] },
  { value: 'Africa/Addis_Ababa',  label: 'Addis-Abeba (UTC+3)',    countries: ['ET'] },
  { value: 'Africa/Djibouti',     label: 'Djibouti (UTC+3)',       countries: ['DJ'] },
  // Afrique du Nord
  { value: 'Africa/Casablanca',   label: 'Casablanca (UTC+1)',     countries: ['MA'] },
  { value: 'Africa/Tunis',        label: 'Tunis (UTC+1)',          countries: ['TN'] },
  { value: 'Africa/Algiers',      label: 'Alger (UTC+1)',          countries: ['DZ'] },
  // Afrique Australe
  { value: 'Africa/Luanda',       label: 'Luanda (UTC+1)',         countries: ['AO'] },
  // International
  { value: 'Europe/Paris',        label: 'Paris (UTC+1/+2)',       countries: ['FR', 'BE'] },
  { value: 'Europe/Brussels',     label: 'Bruxelles (UTC+1/+2)',   countries: ['BE'] },
  { value: 'Asia/Shanghai',       label: 'Shanghai (UTC+8)',       countries: ['CN'] },
  { value: 'UTC',                 label: 'UTC',                    countries: [] },
];

/** Retourne les timezones pertinents pour un pays (+ UTC toujours) */
export function getTimezonesForCountry(countryCode: string): TimezoneOption[] {
  const matching = TIMEZONES.filter(
    tz => tz.countries.includes(countryCode) || tz.value === 'UTC',
  );
  return matching.length > 1 ? matching : TIMEZONES;
}

// ─── Formats de date ─────────────────────────────────────────────────────────

export const DATE_FORMAT_OPTIONS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY — 25/04/2026' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY — 04/25/2026' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD — 2026-04-25' },
];
