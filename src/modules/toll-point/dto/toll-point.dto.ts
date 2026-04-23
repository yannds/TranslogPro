import {
  IsString, IsNumber, IsOptional, IsIn, Min, MaxLength, ValidateNested, IsArray, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class CoordinatesDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

const ALLOWED_KINDS = ['PEAGE', 'POLICE', 'DOUANE', 'EAUX_FORETS', 'FRONTIERE', 'AUTRE'] as const;
const ALLOWED_DIRECTIONS = ['BOTH', 'ONE_WAY'] as const;

export class CreateTollPointDto {
  @IsString() @MaxLength(100)
  name!: string;

  @ValidateNested() @Type(() => CoordinatesDto)
  coordinates!: CoordinatesDto;

  @IsOptional() @IsIn(ALLOWED_KINDS as readonly string[])
  kind?: typeof ALLOWED_KINDS[number];

  @IsNumber() @Min(0)
  tollCostXaf!: number;

  @IsOptional() @IsIn(ALLOWED_DIRECTIONS as readonly string[])
  direction?: typeof ALLOWED_DIRECTIONS[number];

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class UpdateTollPointDto {
  @IsOptional() @IsString() @MaxLength(100)
  name?: string;

  @IsOptional() @ValidateNested() @Type(() => CoordinatesDto)
  coordinates?: CoordinatesDto;

  @IsOptional() @IsIn(ALLOWED_KINDS as readonly string[])
  kind?: typeof ALLOWED_KINDS[number];

  @IsOptional() @IsNumber() @Min(0)
  tollCostXaf?: number;

  @IsOptional() @IsIn(ALLOWED_DIRECTIONS as readonly string[])
  direction?: typeof ALLOWED_DIRECTIONS[number];

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class AttachDetectedDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  tollPointIds!: string[];
}
