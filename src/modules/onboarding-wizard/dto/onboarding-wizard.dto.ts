import {
  IsString, IsEmail, IsOptional, IsArray, ArrayMaxSize, ArrayMinSize,
  ValidateNested, Matches, MinLength, MaxLength, IsIn,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

// ─── Step 1 : Branding ──────────────────────────────────────────────────────

export class UpdateBrandStepDto {
  @IsOptional() @IsString() @MaxLength(120) brandName?: string;
  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/) primaryColor?: string;
  @IsOptional() @IsString() @MaxLength(2000) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(2000) faviconUrl?: string;
  @IsOptional() @IsEmail() @MaxLength(254) supportEmail?: string;
}

// ─── Step 2 : Default agency ────────────────────────────────────────────────

export class UpdateAgencyStepDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;
}

// ─── Step 3 : First station ─────────────────────────────────────────────────

export class CreateFirstStationDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(120) city!: string;
  @IsOptional() @IsIn(['PRINCIPALE', 'RELAIS']) type?: 'PRINCIPALE' | 'RELAIS';
  @IsOptional() lat?: number;
  @IsOptional() lng?: number;
}

// ─── Step 4 : First route (if activity = TICKETING | MIXED) ─────────────────

export class CreateFirstRouteDto {
  /** Station d'origine créée à l'étape 3 — ou n'importe laquelle du tenant. */
  @IsString() originStationId!: string;
  /** Le wizard crée automatiquement une station de destination à partir du nom + ville. */
  @IsString() @MinLength(2) @MaxLength(120) destinationName!: string;
  @IsString() @MinLength(2) @MaxLength(120) destinationCity!: string;
  /** Prix de base en unité mineure de la devise tenant. Ex : 15000 pour 15 000 FCFA. */
  @IsOptional() basePrice?: number;
  @IsOptional() distanceKm?: number;
  @IsOptional() durationMin?: number;
}

// ─── Step 5 : Invite team ───────────────────────────────────────────────────

export class TeamInviteItemDto {
  @IsEmail() @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsString() @MinLength(2) @MaxLength(120) name!: string;

  /**
   * Slug du rôle à assigner (ex: "CASHIER", "AGENCY_MANAGER", "DRIVER").
   * Les rôles sont seedés par OnboardingService — voir iam.seed.ts.
   */
  @IsString() @MaxLength(64) roleSlug!: string;
}

export class InviteTeamStepDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => TeamInviteItemDto)
  invites!: TeamInviteItemDto[];
}
