import {
  IsString, IsNumber, IsOptional, Min, IsBoolean, IsDateString, IsEnum,
} from 'class-validator';

export enum FuelLogType {
  DIESEL     = 'DIESEL',
  PETROL     = 'PETROL',
  ADBLUE     = 'ADBLUE',
}

export class CreateFuelLogDto {
  @IsString()
  busId: string;

  @IsEnum(FuelLogType)
  fuelType: FuelLogType;

  /** Quantité en litres */
  @IsNumber() @Min(0.1)
  quantityL: number;

  /** Date du plein (ISO 8601) — par défaut : now */
  @IsDateString() @IsOptional()
  logDate?: string;

  /** Prix unitaire (XOF/litre) */
  @IsNumber() @Min(0) @IsOptional()
  pricePerL?: number;

  /** Coût total (XOF) — calculé si pricePerL fourni */
  @IsNumber() @Min(0) @IsOptional()
  totalCost?: number;

  /** Kilométrage au moment du plein */
  @IsNumber() @Min(0) @IsOptional()
  odometerKm?: number;

  /** Nom de la station-service */
  @IsString() @IsOptional()
  stationName?: string;

  /** Plein complet (pour calcul consommation réelle) */
  @IsBoolean() @IsOptional()
  fullTank?: boolean;

  @IsString() @IsOptional()
  note?: string;
}
