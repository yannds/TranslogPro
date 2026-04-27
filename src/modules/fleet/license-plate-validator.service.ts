import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * LicensePlateValidator — validation graduée des immatriculations véhicules.
 *
 * Architecture en 3 niveaux (voir docs/LICENSE_PLATE_FORMATS.md) :
 *   1. Anti-poubelle (hard reject)  : longueur < 3, aucun caractère alphanum,
 *                                     uniquement des séparateurs ("---", "...", "   ").
 *   2. Hors masque connu (warn)     : la plaque ne match aucun masque enregistré
 *                                     pour le pays — l'admin peut forcer via flag.
 *   3. Match (silent)                : la plaque match au moins un masque connu.
 *
 * Convention de masque permissive : tout chiffre = un emplacement chiffre (0-9),
 * toute lettre = un emplacement lettre (A-Z hors excludedLetters), autres caractères
 * = séparateur littéral. Plusieurs masques par pays autorisés (ancien + nouveau).
 *
 * La config est lue depuis TenantBusinessConfig.licensePlateFormats (Json), seedée
 * automatiquement à l'onboarding et backfillée pour les tenants existants.
 *
 * Doublons : check séparé via `findDuplicate()`. Warn-only — collision inter-pays
 * (Gabon/Cameroun même format) est un cas légitime à laisser passer avec confirmation.
 */
@Injectable()
export class LicensePlateValidator {
  private readonly logger = new Logger(LicensePlateValidator.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalise une plaque : trim, uppercase, séparateurs unifiés.
   * Conserve uniquement [A-Z0-9 -].
   */
  normalize(plate: string): string {
    return plate
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .replace(/[^A-Z0-9\- ]/g, '');
  }

  /**
   * Niveau 1 — Anti-poubelle (hard reject).
   * Retourne true si la plaque est manifestement invalide (à rejeter).
   */
  isJunk(plate: string): boolean {
    const normalized = this.normalize(plate);
    if (normalized.length < 3) return true;
    // Aucun caractère alphanumérique → bruit pur (---, ..., espaces)
    if (!/[A-Z0-9]/.test(normalized)) return true;
    return false;
  }

  /**
   * Convertit un masque humain en RegExp.
   *
   * Convention :
   *   - Tout chiffre (0-9) dans le masque  → un emplacement chiffre [0-9]
   *   - Toute lettre (A-Z) dans le masque  → un emplacement lettre (A-Z\excludedLetters)
   *   - Tout autre caractère                → littéral (séparateur)
   *
   * Exemples :
   *   `001-AS-4`    → /^[0-9]{3}-[A-Z]{2}-[0-9]{1}$/
   *   `989-BB-SS`   → /^[0-9]{3}-[A-Z]{2}-[A-Z]{2}$/
   *   `AB-123-CD`   → /^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$/
   */
  maskToRegex(mask: string, excludedLetters: string[] = []): RegExp {
    const allowedLetters = this.allowedLetterClass(excludedLetters);
    let pattern = '^';
    for (const char of mask) {
      if (/[0-9]/.test(char)) pattern += '[0-9]';
      else if (/[A-Za-z]/.test(char)) pattern += allowedLetters;
      else pattern += this.escapeRegex(char);
    }
    pattern += '$';
    return new RegExp(pattern);
  }

  /**
   * Niveau 2 — match avec un masque connu.
   * Retourne `'match'` si la plaque match au moins un masque, `'unknown'` sinon.
   * Si aucun masque n'est défini pour le pays, on retourne `'unknown'` (laisser passer
   * en warn — pas de blocage car on n'a pas la connaissance pour rejeter).
   */
  matchKnownMask(plate: string, country: string, formats: LicensePlateFormatsConfig): MaskMatchResult {
    const normalized = this.normalize(plate);
    const config = formats[country?.toUpperCase()];
    if (!config || !config.masks || config.masks.length === 0) {
      return { status: 'unknown', reason: 'no-masks-defined' };
    }
    for (const mask of config.masks) {
      const regex = this.maskToRegex(mask, config.excludedLetters ?? []);
      if (regex.test(normalized)) {
        return { status: 'match', matchedMask: mask };
      }
    }
    return { status: 'unknown', reason: 'no-mask-matched', triedMasks: config.masks };
  }

  /**
   * Validation orchestrée : normalize + niveau 1 (junk) + niveau 2 (mask).
   * Le caller décide quoi faire avec status='unknown' (warn-only ou exiger
   * confirmedAtypical=true selon le contexte).
   */
  validate(opts: {
    plate:    string;
    country:  string;
    formats:  LicensePlateFormatsConfig;
  }): ValidationResult {
    const normalized = this.normalize(opts.plate);
    if (this.isJunk(opts.plate)) {
      return { status: 'invalid', normalized, reason: 'junk' };
    }
    const match = this.matchKnownMask(opts.plate, opts.country, opts.formats);
    if (match.status === 'match') {
      return { status: 'ok', normalized, matchedMask: match.matchedMask };
    }
    return { status: 'unknown', normalized, reason: match.reason, triedMasks: match.triedMasks };
  }

  /**
   * Recherche un bus existant (autre que `excludeBusId`) avec le même plateNumber
   * dans le tenant. Permet au caller de signaler un doublon (warn-only).
   */
  async findDuplicate(opts: {
    plateNumber:    string;
    tenantId:       string;
    excludeBusId?:  string;
  }): Promise<{ id: string; plateNumber: string } | null> {
    const normalized = this.normalize(opts.plateNumber);
    const found = await this.prisma.bus.findFirst({
      where: {
        tenantId:    opts.tenantId,
        plateNumber: normalized,
        ...(opts.excludeBusId ? { NOT: { id: opts.excludeBusId } } : {}),
      },
      select: { id: true, plateNumber: true },
    });
    return found;
  }

  // ─── Helpers privés ──────────────────────────────────────────────────────

  private allowedLetterClass(excluded: string[]): string {
    if (excluded.length === 0) return '[A-Z]';
    const excludedUpper = excluded.map(l => l.toUpperCase());
    const allowed = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(c => !excludedUpper.includes(c));
    return `[${allowed.join('')}]`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LicensePlateFormatEntry {
  label?:           string;
  masks:            string[];
  excludedLetters?: string[];
  examples?:        string[];
  notes?:           string;
}

export type LicensePlateFormatsConfig = Record<string, LicensePlateFormatEntry>;

export type MaskMatchResult =
  | { status: 'match';   matchedMask: string }
  | { status: 'unknown'; reason: 'no-masks-defined' | 'no-mask-matched'; triedMasks?: string[] };

export type ValidationResult =
  | { status: 'ok';      normalized: string; matchedMask: string }
  | { status: 'invalid'; normalized: string; reason: 'junk' }
  | { status: 'unknown'; normalized: string; reason?: 'no-masks-defined' | 'no-mask-matched'; triedMasks?: string[] };
