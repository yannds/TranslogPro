/**
 * Phone Helper — Normalisation E.164.
 *
 * Politique :
 *   - Un numéro stocké ou comparé doit TOUJOURS être en E.164 (préfixe +,
 *     chiffres uniquement, pas d'espace/tiret/parenthèse).
 *   - La clé de matching CRM s'appuie sur cette normalisation.
 *
 * Limites volontaires (pas de dépendance libphonenumber) :
 *   - On couvre la table des pays Afrique francophone + voisins + principaux
 *     internationaux. Les cas hors table retournent { ok:false, reason:'unknown_country' }.
 *   - Pas de validation longueur strict par pays (les variantes opérateur
 *     bougent) — on garde une fourchette raisonnable 6-15 chiffres.
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

export interface PhoneNormalizeOk {
  ok: true;
  e164: string;        // ex. "+242061234567"
  dial: string;        // ex. "242"
  national: string;    // ex. "061234567"
}
export interface PhoneNormalizeErr {
  ok: false;
  reason: 'empty' | 'too_short' | 'too_long' | 'non_digit' | 'unknown_country' | 'bad_format';
}
export type PhoneNormalizeResult = PhoneNormalizeOk | PhoneNormalizeErr;

/**
 * Normalise un numéro en E.164.
 *
 * Règles d'entrée acceptées :
 *   - Préfixé "+242 06 12 34 567" / "+24206..."        → conserve l'indicatif
 *   - "00242 06..."                                    → "+" remplaçant "00"
 *   - "06 12 34 56 78"   + countryIso='CG'             → préfixe auto "+242"
 *   - Chiffres et séparateurs [+ espace - . ( )] acceptés ; tout le reste rejeté.
 *
 * La sortie est DÉTERMINISTE : même entrée logique ⇒ même e164 ⇒ upsert idempotent.
 */
export function normalizePhone(
  raw: string | null | undefined,
  countryIso: string | null | undefined = null,
): PhoneNormalizeResult {
  if (!raw) return { ok: false, reason: 'empty' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  // Autorise seulement chiffres et séparateurs "+", espace, tiret, point, parenthèses.
  if (!/^[+\d\s().\-]+$/.test(trimmed)) {
    return { ok: false, reason: 'non_digit' };
  }

  let cleaned = trimmed.replace(/[\s().\-]/g, '');
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);

  let dial: string | null = null;
  let national: string;

  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (!/^\d+$/.test(digits)) return { ok: false, reason: 'non_digit' };
    // Résoudre l'indicatif : longest-match contre la table
    const sorted = Object.values(COUNTRY_TO_DIAL).sort((a, b) => b.length - a.length);
    const found = sorted.find(d => digits.startsWith(d));
    if (!found) return { ok: false, reason: 'unknown_country' };
    dial = found;
    national = digits.slice(found.length);
  } else {
    if (!/^\d+$/.test(cleaned)) return { ok: false, reason: 'non_digit' };
    const iso = (countryIso ?? '').toUpperCase();
    const resolved = COUNTRY_TO_DIAL[iso];
    if (!resolved) return { ok: false, reason: 'unknown_country' };
    dial = resolved;
    // Certains pays écrivent le national avec un "0" initial (ex. France, CG).
    // On retire ce zéro pour ne pas le dupliquer après l'indicatif.
    national = cleaned.replace(/^0+/, '');
  }

  if (national.length < 6)  return { ok: false, reason: 'too_short' };
  if (national.length > 14) return { ok: false, reason: 'too_long' };

  return { ok: true, e164: `+${dial}${national}`, dial, national };
}

/**
 * Version "throwable" pour les DTOs : soit un E.164 valide, soit une erreur
 * métier. À utiliser UNIQUEMENT dans un code path déjà protégé par validation
 * (sinon préférer `normalizePhone` et gérer le result explicitement).
 */
export function requireE164(raw: string, countryIso?: string | null): string {
  const r = normalizePhone(raw, countryIso);
  if (!r.ok) throw new Error(`invalid_phone:${r.reason}`);
  return r.e164;
}

/** true si le numéro peut être normalisé en E.164 avec ce pays par défaut. */
export function isValidPhone(raw: string, countryIso?: string | null): boolean {
  return normalizePhone(raw, countryIso).ok;
}

/** Masque un numéro pour affichage public (ex. "+242 06 •• •• 567"). */
export function maskPhone(e164: string): string {
  if (!e164 || !e164.startsWith('+')) return e164 ?? '';
  const digits = e164.slice(1);
  if (digits.length < 6) return e164;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-3);
  return `+${head}••••${tail}`;
}
