/**
 * Phone Config — placeholders E.164 par pays.
 *
 * Utilisé uniquement pour les placeholders d'input (ergonomie) — la validation
 * reste faite côté serveur via `normalizePhone` (src/common/helpers/phone.helper.ts).
 *
 * Miroir de la table COUNTRY_TO_DIAL du backend. Le national_example est un
 * format masqué générique (XX XX XX XX) plutôt qu'un numéro réel : évite
 * les faux positifs si un user copie-colle le placeholder.
 */

const COUNTRY_TO_DIAL: Record<string, string> = {
  // Afrique centrale
  CG: '242', CD: '243', GA: '241', CM: '237', CF: '236', TD: '235',
  GQ: '240', ST: '239',
  // Afrique de l'Ouest
  SN: '221', ML: '223', CI: '225', BF: '226', NE: '227', TG: '228',
  BJ: '229', GN: '224', GW: '245', GM: '220', MR: '222', CV: '238',
  // Afrique du Nord
  MA: '212', DZ: '213', TN: '216', LY: '218', EG: '20',
  // Afrique de l'Est / Sud
  KE: '254', TZ: '255', UG: '256', RW: '250', BI: '257', ET: '251',
  SO: '252', DJ: '253', MG: '261', MU: '230', ZA: '27', ZW: '263',
  AO: '244', MZ: '258',
  // Europe / Amérique / Moyen-Orient (principaux)
  FR: '33', BE: '32', CH: '41', DE: '49', IT: '39', ES: '34',
  GB: '44', PT: '351', LU: '352', NL: '31',
  US: '1', CA: '1',
  CN: '86', IN: '91', AE: '971', SA: '966', TR: '90',
};

/**
 * Retourne un placeholder E.164 pour un pays donné.
 * Fallback CG (+242) si pays inconnu — maintient l'UX familière pour le marché
 * principal et est cohérent avec le default tenant XAF.
 */
export function getPhonePlaceholder(country: string | null | undefined): string {
  const dial = (country && COUNTRY_TO_DIAL[country.toUpperCase()]) || '242';
  return `+${dial} XX XX XX XX`;
}
