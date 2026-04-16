import {
  IsString, IsInt, IsOptional, Min, IsEnum, IsNumber, IsDateString,
} from 'class-validator';
import { BusType, FuelType, EngineType } from './create-bus.dto';

export class UpdateBusDto {
  @IsString() @IsOptional()
  plateNumber?: string;

  @IsEnum(BusType) @IsOptional()
  type?: BusType;

  @IsInt() @Min(1) @IsOptional()
  capacity?: number;

  @IsString() @IsOptional()
  agencyId?: string;

  @IsString() @IsOptional()
  model?: string;

  @IsInt() @IsOptional()
  year?: number;

  // ── Champs techniques optionnels ──────────────────────────────────────────

  @IsString() @IsOptional()
  vin?: string;

  @IsEnum(FuelType) @IsOptional()
  fuelType?: FuelType;

  @IsEnum(EngineType) @IsOptional()
  engineType?: EngineType;

  @IsNumber() @Min(0) @IsOptional()
  fuelTankCapacityL?: number;

  @IsNumber() @Min(0) @IsOptional()
  adBlueTankCapacityL?: number;

  @IsNumber() @Min(0) @IsOptional()
  luggageCapacityKg?: number;

  @IsNumber() @Min(0) @IsOptional()
  luggageCapacityM3?: number;

  @IsDateString() @IsOptional()
  registrationDate?: string;

  @IsDateString() @IsOptional()
  purchaseDate?: string;

  @IsNumber() @Min(0) @IsOptional()
  purchasePrice?: number;

  @IsNumber() @Min(0) @IsOptional()
  initialOdometerKm?: number;

  @IsNumber() @Min(0) @IsOptional()
  fuelConsumptionPer100Km?: number;

  @IsNumber() @Min(0) @IsOptional()
  adBlueConsumptionPer100Km?: number;
}
