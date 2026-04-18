import {
  IsEmail, IsString, IsOptional, MaxLength, MinLength,
  Matches, IsIn, ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Types d'activité : conditionne l'onboarding wizard (étape 4) et les modules
 * activés par défaut. Défini ici pour ne pas dépendre d'un enum backend encore
 * inexistant — à aligner si un enum `BusinessActivity` est introduit.
 */
export const BUSINESS_ACTIVITIES = ['TICKETING', 'PARCELS', 'MIXED'] as const;
export type BusinessActivity = typeof BUSINESS_ACTIVITIES[number];

export class PublicSignupDto {
  // ── Admin ──────────────────────────────────────────────────────────────────
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  adminName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  // ── Entreprise ─────────────────────────────────────────────────────────────
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  companyName!: string;

  /** Sous-domaine souhaité. 3-32 caractères, [a-z0-9-], sans tirets collés au bord. */
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/, {
    message: 'Le slug doit contenir 3 à 32 caractères (a-z, 0-9, tirets non collés aux bords).',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  slug!: string;

  /** ISO 3166-1 alpha-2. Défaut 'CG' côté service. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(fr|en|wo|ln|ktu|ar|pt|es)$/)
  language?: string;

  @IsOptional()
  @IsIn(BUSINESS_ACTIVITIES as readonly string[])
  activity?: BusinessActivity;

  // ── Plan ───────────────────────────────────────────────────────────────────
  /** Slug du plan choisi (ex: 'starter'). Si absent, le premier plan public actif est utilisé. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  planSlug?: string;

  // ── Anti-abus ──────────────────────────────────────────────────────────────
  /** Honeypot : doit rester vide. */
  @IsOptional()
  @IsString()
  @MaxLength(0)
  company_website?: string;

  /** Consentement RGPD. */
  @IsOptional()
  @ValidateIf(o => o.acceptTerms !== undefined)
  @IsString()
  acceptTerms?: string;
}
