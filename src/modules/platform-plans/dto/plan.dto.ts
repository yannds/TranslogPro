import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * DTO création d'un plan SaaS. Tout DB-driven — aucune valeur par défaut
 * hardcodée côté code. Slug immuable après création.
 */
export class CreatePlanDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug doit être en kebab-case minuscule' })
  @MaxLength(64)
  slug!: string;

  @IsString()
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency doit être un code ISO 4217 (3 lettres MAJ)' })
  currency!: string;

  @IsString()
  billingCycle!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  limits?: Record<string, unknown>;

  @IsOptional()
  sla?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  moduleKeys?: string[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  billingCycle?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  limits?: Record<string, unknown>;

  @IsOptional()
  sla?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  moduleKeys?: string[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
