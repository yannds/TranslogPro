import {
  IsString, IsInt, IsOptional, Min, IsEnum, IsNumber, IsDateString, IsArray,
} from 'class-validator';

export enum BusType {
  STANDARD  = 'STANDARD',
  CONFORT   = 'CONFORT',
  VIP       = 'VIP',
  MINIBUS   = 'MINIBUS',
}

export enum BusAmenity {
  WIFI              = 'WIFI',
  AC                = 'AC',
  TOILETS           = 'TOILETS',
  USB_CHARGING      = 'USB_CHARGING',
  RECLINING_SEATS   = 'RECLINING_SEATS',
  TV                = 'TV',
  SNACK_BAR         = 'SNACK_BAR',
  BLANKETS          = 'BLANKETS',
  LUGGAGE_TRACKING  = 'LUGGAGE_TRACKING',
}

export enum FuelType {
  DIESEL      = 'DIESEL',
  PETROL      = 'PETROL',
  BIO_DIESEL  = 'BIO_DIESEL',
  HYBRID      = 'HYBRID',
  ELECTRIC    = 'ELECTRIC',
}

export enum EngineType {
  EURO_3 = 'EURO_3',
  EURO_4 = 'EURO_4',
  EURO_5 = 'EURO_5',
  EURO_6 = 'EURO_6',
}

export class CreateBusDto {
  @IsString()
  plateNumber: string;

  @IsEnum(BusType)
  type: BusType;

  @IsInt() @Min(1)
  capacity: number;

  @IsString()
  agencyId: string;

  @IsString() @IsOptional()
  model?: string;

  @IsInt() @IsOptional()
  year?: number;

  // ── Champs techniques optionnels ──────────────────────────────────────────

  /** Numéro de châssis / VIN */
  @IsString() @IsOptional()
  vin?: string;

  /** Type de carburant */
  @IsEnum(FuelType) @IsOptional()
  fuelType?: FuelType;

  /** Norme moteur */
  @IsEnum(EngineType) @IsOptional()
  engineType?: EngineType;

  /** Capacité réservoir carburant (litres) */
  @IsNumber() @Min(0) @IsOptional()
  fuelTankCapacityL?: number;

  /** Capacité réservoir AdBlue (litres) */
  @IsNumber() @Min(0) @IsOptional()
  adBlueTankCapacityL?: number;

  /** Capacité soute bagages (kg) */
  @IsNumber() @Min(0) @IsOptional()
  luggageCapacityKg?: number;

  /** Capacité soute bagages (m³) */
  @IsNumber() @Min(0) @IsOptional()
  luggageCapacityM3?: number;

  /** Date de 1ère immatriculation (ISO 8601) */
  @IsDateString() @IsOptional()
  registrationDate?: string;

  /** Date d'acquisition (ISO 8601) */
  @IsDateString() @IsOptional()
  purchaseDate?: string;

  /** Prix d'achat (XOF) */
  @IsNumber() @Min(0) @IsOptional()
  purchasePrice?: number;

  /** Kilométrage initial à l'enregistrement */
  @IsNumber() @Min(0) @IsOptional()
  initialOdometerKm?: number;

  /** Consommation déclarée/constructeur (L/100km) */
  @IsNumber() @Min(0) @IsOptional()
  fuelConsumptionPer100Km?: number;

  /** Consommation AdBlue déclarée (L/100km) — moteurs Euro 6 */
  @IsNumber() @Min(0) @IsOptional()
  adBlueConsumptionPer100Km?: number;

  /** Commodités du véhicule */
  @IsArray() @IsEnum(BusAmenity, { each: true }) @IsOptional()
  amenities?: BusAmenity[];
}
