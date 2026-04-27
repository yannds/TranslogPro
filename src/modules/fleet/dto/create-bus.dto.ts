import {
  IsString, IsInt, IsOptional, Min, IsEnum, IsNumber, IsDateString, IsArray, IsBoolean, Length,
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
  @IsString() @Length(3, 32)
  plateNumber: string;

  /**
   * Code pays ISO 3166-1 alpha-2 de l'immatriculation (ex: "CG", "GA", "FR").
   * Si absent, le service prend le pays du tenant. Permet aux tenants ayant des
   * agences dans plusieurs pays de saisir des plaques de pays différents.
   */
  @IsString() @IsOptional()
  plateCountry?: string;

  /**
   * Confirme une plaque atypique (ne match aucun masque connu pour le pays).
   * Sans ce flag, le service répond 400 avec l'info "atypique" pour que l'UI
   * demande confirmation à l'admin (warn-only, jamais hard reject sur le pattern).
   */
  @IsBoolean() @IsOptional()
  confirmedAtypical?: boolean;

  /**
   * Confirme un doublon de plaque dans le tenant (collision inter-pays légitime).
   * Sans ce flag, le service répond 409 avec le bus existant pour que l'UI
   * demande confirmation.
   */
  @IsBoolean() @IsOptional()
  confirmedDuplicate?: boolean;

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
