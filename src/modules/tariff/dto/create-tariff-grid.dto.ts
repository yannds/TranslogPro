import { IsString, IsOptional, IsNumber, IsBoolean, IsInt, IsDateString, Min, Max } from 'class-validator';

export class CreateTariffGridDto {
  @IsString()
  routeId: string;

  @IsString()
  name: string;

  @IsOptional() @IsString()
  busType?: string;

  @IsOptional() @IsNumber() @Min(0)
  multiplier?: number;

  @IsOptional() @IsNumber() @Min(0)
  fixedPrice?: number;

  @IsOptional() @IsInt() @Min(0) @Max(23)
  startHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(23)
  endHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(127)
  dayMask?: number;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  priority?: number;
}

export class UpdateTariffGridDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  busType?: string;

  @IsOptional() @IsNumber() @Min(0)
  multiplier?: number;

  @IsOptional() @IsNumber() @Min(0)
  fixedPrice?: number;

  @IsOptional() @IsInt() @Min(0) @Max(23)
  startHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(23)
  endHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(127)
  dayMask?: number;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsInt()
  priority?: number;
}
