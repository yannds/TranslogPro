import { IsString, IsOptional, IsNumber, IsBoolean, IsInt, IsDateString, Min } from 'class-validator';

export class CreatePromotionDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional() @IsString()
  description?: string;

  @IsString()
  discountType: string; // PERCENTAGE | FIXED_AMOUNT

  @IsNumber() @Min(0)
  discountValue: number;

  @IsOptional() @IsInt() @Min(1)
  maxUses?: number;

  @IsOptional() @IsInt() @Min(1)
  maxPerUser?: number;

  @IsOptional() @IsNumber() @Min(0)
  minAmount?: number;

  @IsOptional() @IsString()
  routeId?: string;

  @IsOptional() @IsString()
  busType?: string;

  @IsDateString()
  validFrom: string;

  @IsDateString()
  validTo: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  discountType?: string;

  @IsOptional() @IsNumber() @Min(0)
  discountValue?: number;

  @IsOptional() @IsInt() @Min(1)
  maxUses?: number;

  @IsOptional() @IsInt() @Min(1)
  maxPerUser?: number;

  @IsOptional() @IsNumber() @Min(0)
  minAmount?: number;

  @IsOptional() @IsString()
  routeId?: string;

  @IsOptional() @IsString()
  busType?: string;

  @IsOptional() @IsDateString()
  validFrom?: string;

  @IsOptional() @IsDateString()
  validTo?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}
