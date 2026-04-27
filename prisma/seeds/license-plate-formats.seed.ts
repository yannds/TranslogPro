/**
 * License Plate Formats — Seed initial des masques d'immatriculation par pays.
 *
 * Source : Wikipedia "Vehicle registration plates of [country]" + connaissance terrain
 * (notamment Congo Brazzaville). Les masques utilisent la convention permissive du
 * `LicensePlateValidator` : tout chiffre dans le masque = un emplacement chiffre,
 * toute lettre = un emplacement lettre (hors excludedLetters), autres caractères =
 * séparateurs littéraux.
 *
 * Plusieurs masques par pays autorisés (ancien + nouveau format en circulation).
 *
 * **Mode warn-only** : ces masques ne bloquent pas — ils servent à détecter les
 * fautes de frappe et à afficher un placeholder dans l'UI. L'admin tenant peut
 * éditer/ajouter via /admin/settings/vehicle-rules.
 *
 * Voir docs/LICENSE_PLATE_FORMATS.md.
 */

export interface LicensePlateFormatEntry {
  label?:           string;
  masks:            string[];
  excludedLetters?: string[];
  examples?:        string[];
  notes?:           string;
}

export type LicensePlateFormatsConfig = Record<string, LicensePlateFormatEntry>;

export const DEFAULT_LICENSE_PLATE_FORMATS: LicensePlateFormatsConfig = {
  // ── CEMAC — Afrique centrale (XAF) ─────────────────────────────────────────
  CG: {
    label:           'Congo Brazzaville',
    masks:           ['999-A-9', '999-A-99', '999-AA-9', '999-AA-99', '999-AAA-9', '999-AAA-99'],
    excludedLetters: ['W', 'Y', 'O', 'I', 'Z'],
    examples:        ['001-AS-4', '234-AB-12', '999-AAQ-4'],
    notes:           'NNN civil 001–999 (4 chiffres = État/armée). Q = véhicule d\'État. Suffixe = code département.',
  },
  CD: {
    label:    'RD Congo',
    masks:    ['9999-AA-99', 'AAA-9999'],
    examples: ['1234-KN-12', 'KIN-1234'],
    notes:    'Plusieurs séries provinciales en circulation. Format à reconfirmer.',
  },
  CM: {
    label:    'Cameroun',
    masks:    ['AA-999-AA'],
    examples: ['CE-123-AA', 'LT-456-BC'],
    notes:    '2 premières lettres = code région.',
  },
  GA: {
    label:    'Gabon',
    masks:    ['AA-999-AA', '9999-A9-A'],
    examples: ['LB-123-AB', '1234-G1-A'],
    notes:    'Nouveau format aligné Cameroun. Ancien format `XXXX G9 A` (G + chiffre province) toujours visible.',
  },
  TD: {
    label:    'Tchad',
    masks:    ['9999-AA-9'],
    examples: ['1234-AB-1'],
  },
  CF: {
    label:    'Centrafrique',
    masks:    ['9999-AA-9'],
    examples: ['1234-AB-1'],
  },
  GQ: {
    label:    'Guinée Équatoriale',
    masks:    ['A-9999-A'],
    examples: ['M-1234-A', 'B-5678-A'],
    notes:    'M = Malabo, B = Bata.',
  },

  // ── UEMOA — Afrique de l'Ouest (XOF) ───────────────────────────────────────
  SN: {
    label:    'Sénégal',
    masks:    ['AA-9999-A'],
    examples: ['DK-1234-A', 'TH-5678-B'],
    notes:    '2 premières lettres = code région (DK Dakar, TH Thiès, ZG Ziguinchor…).',
  },
  CI: {
    label:    'Côte d\'Ivoire',
    masks:    ['9999-AA-99'],
    examples: ['1234-AB-01', '5678-CD-12'],
    notes:    'Format SIV depuis 2014.',
  },
  ML: {
    label:    'Mali',
    masks:    ['A-9999-AA', '9999-A-99'],
    examples: ['A-1234-BC', '5678-D-12'],
  },
  BF: {
    label:    'Burkina Faso',
    masks:    ['99-9999-AA'],
    examples: ['11-1234-BF'],
    notes:    'Code province + numéro + BF.',
  },
  NE: {
    label:    'Niger',
    masks:    ['AA-999-A'],
    examples: ['NE-123-A'],
  },
  TG: {
    label:    'Togo',
    masks:    ['9999-A-AA'],
    examples: ['1234-A-TG'],
  },
  BJ: {
    label:    'Bénin',
    masks:    ['9999-AA-99'],
    examples: ['1234-RB-01'],
  },
  GW: {
    label:    'Guinée Bissau',
    masks:    ['AA-99-99'],
    examples: ['BS-12-34'],
  },

  // ── Afrique de l'Ouest hors UEMOA ──────────────────────────────────────────
  GN: {
    label:    'Guinée Conakry',
    masks:    ['9999-A-99'],
    examples: ['1234-A-12'],
  },
  SL: {
    label:    'Sierra Leone',
    masks:    ['AAA-999'],
    examples: ['AFA-123'],
  },
  LR: {
    label:    'Libéria',
    masks:    ['A-99999'],
    examples: ['A-12345'],
  },
  NG: {
    label:    'Nigeria',
    masks:    ['AAA-999A'],
    examples: ['ABC-123DE'],
    notes:    'Format SIV depuis 2011.',
  },
  GH: {
    label:    'Ghana',
    masks:    ['AA-9999-99'],
    examples: ['GR-1234-22'],
    notes:    'Région-numéro-année.',
  },
  GM: {
    label:    'Gambie',
    masks:    ['AAA-9999'],
    examples: ['BJL-1234'],
  },
  CV: {
    label:    'Cap-Vert',
    masks:    ['AA-99-AA'],
    examples: ['ST-12-AB'],
    notes:    'Préfixe = île.',
  },

  // ── Afrique centrale lusophone ────────────────────────────────────────────
  AO: {
    label:    'Angola',
    masks:    ['AA-99-99-AA'],
    examples: ['LD-12-34-AB'],
  },
  ST: {
    label:    'Sao Tomé-et-Principe',
    masks:    ['AA-9999'],
    examples: ['ST-1234'],
  },

  // ── Afrique de l'Est ──────────────────────────────────────────────────────
  RW: {
    label:    'Rwanda',
    masks:    ['ABB-999A'],
    examples: ['RAB-123A'],
    notes:    'Toutes les plaques civiles commencent par R.',
  },
  BI: {
    label:    'Burundi',
    masks:    ['A-9999-A'],
    examples: ['A-1234-B'],
  },
  KE: {
    label:    'Kenya',
    masks:    ['ABB-999A'],
    examples: ['KCH-123A'],
    notes:    'Toutes les plaques civiles commencent par K.',
  },
  UG: {
    label:    'Ouganda',
    masks:    ['ABB-999A'],
    examples: ['UAB-123E'],
    notes:    'Toutes les plaques civiles commencent par U.',
  },
  ET: {
    label:    'Éthiopie',
    masks:    ['9-AAA-99999'],
    examples: ['1-ABC-12345'],
    notes:    'Code régional numérique. Alphabet amharique sur la plaque physique.',
  },
  DJ: {
    label:    'Djibouti',
    masks:    ['99-AA-99'],
    examples: ['12-AB-34'],
  },

  // ── Maghreb ───────────────────────────────────────────────────────────────
  MA: {
    label:    'Maroc',
    masks:    ['99999-A-99'],
    examples: ['12345-A-1'],
    notes:    'Lettre arabe sur la plaque physique, romanisée pour saisie.',
  },
  TN: {
    label:    'Tunisie',
    masks:    ['9999-AAA-999'],
    examples: ['1234-TUN-123'],
    notes:    'Mot arabe "تونس" entre les chiffres, romanisé pour saisie.',
  },
  DZ: {
    label:    'Algérie',
    masks:    ['999999-999-99'],
    examples: ['123456-345-23'],
    notes:    'Numéro-wilaya-année.',
  },

  // ── Hors Afrique ──────────────────────────────────────────────────────────
  CN: {
    label:    'Chine',
    masks:    ['AA-A99999'],
    examples: ['BJ-A12345'],
    notes:    'Caractère chinois (province) sur la plaque physique, romanisé pour saisie.',
  },
  FR: {
    label:    'France',
    masks:    ['AA-999-AA'],
    examples: ['AB-123-CD'],
    notes:    'SIV depuis 2009.',
  },
  BE: {
    label:    'Belgique',
    masks:    ['9-AAA-999'],
    examples: ['1-ABC-123'],
    notes:    'Format depuis 2010.',
  },
};

/**
 * Seed/backfill idempotent : pour chaque tenant, ajoute les formats par défaut
 * dans `TenantBusinessConfig.licensePlateFormats` si vide ou si certains pays
 * manquent. N'écrase JAMAIS un format déjà personnalisé par l'admin tenant.
 *
 * @returns nombre de tenants mis à jour
 */
export async function seedLicensePlateFormats(
  prisma: { tenantBusinessConfig: any },
  opts: { tenantId?: string; logger?: { log: (m: string) => void } } = {},
): Promise<number> {
  const log = opts.logger?.log ?? (() => {});
  const where = opts.tenantId ? { tenantId: opts.tenantId } : {};

  const configs = await prisma.tenantBusinessConfig.findMany({
    where,
    select: { id: true, tenantId: true, licensePlateFormats: true },
  });

  let updated = 0;
  for (const cfg of configs) {
    const existing = (cfg.licensePlateFormats ?? {}) as LicensePlateFormatsConfig;
    // Merge : le seed remplit uniquement les pays absents.
    const merged: LicensePlateFormatsConfig = { ...DEFAULT_LICENSE_PLATE_FORMATS, ...existing };
    // Si déjà identique, skip.
    if (JSON.stringify(merged) === JSON.stringify(existing)) continue;

    await prisma.tenantBusinessConfig.update({
      where: { id: cfg.id },
      data:  { licensePlateFormats: merged as any },
    });
    updated++;
    log(`[licensePlateFormats] tenant ${cfg.tenantId} → ${Object.keys(merged).length} pays seedés`);
  }
  return updated;
}
