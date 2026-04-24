import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ITEM_KINDS = ['CHECK', 'QUANTITY', 'DOCUMENT', 'ACKNOWLEDGE', 'INFO'] as const;
export const AUTO_SOURCES = ['DRIVER_REST_HOURS', 'WEATHER', 'MANIFEST_LOADED', 'ROUTE_CONFIRMED'] as const;

export class CreateTemplateDto {
  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string | null;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class DuplicateTemplateDto {
  @IsString() @MaxLength(120)
  newName!: string;
}

export class UpsertSectionDto {
  @IsString() @MaxLength(80)
  code!: string;

  @IsString() @MaxLength(120)
  titleFr!: string;

  @IsString() @MaxLength(120)
  titleEn!: string;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  order?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpsertItemDto {
  @IsString() @MaxLength(80)
  code!: string;

  @IsIn(ITEM_KINDS as unknown as string[])
  kind!: (typeof ITEM_KINDS)[number];

  @IsString() @MaxLength(200)
  labelFr!: string;

  @IsString() @MaxLength(200)
  labelEn!: string;

  @IsOptional() @IsString() @MaxLength(800)
  helpFr?: string;

  @IsOptional() @IsString() @MaxLength(800)
  helpEn?: string;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  requiredQty?: number;

  @IsOptional() @IsBoolean()
  isMandatory?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  order?: number;

  @IsOptional() @IsBoolean()
  evidenceAllowed?: boolean;

  @IsOptional() @IsIn(AUTO_SOURCES as unknown as string[])
  autoSource?: (typeof AUTO_SOURCES)[number];
}

export class ToggleItemDto {
  @IsBoolean()
  isActive!: boolean;
}
