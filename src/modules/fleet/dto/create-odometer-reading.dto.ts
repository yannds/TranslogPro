import { IsString, IsNumber, IsOptional, Min, IsDateString, IsEnum } from 'class-validator';

export enum OdometerSource {
  MANUAL      = 'MANUAL',
  TRIP        = 'TRIP',
  MAINTENANCE = 'MAINTENANCE',
  GPS         = 'GPS',
}

export class CreateOdometerReadingDto {
  @IsString()
  busId: string;

  /** Valeur odomètre (km) */
  @IsNumber() @Min(0)
  readingKm: number;

  /** Date du relevé (ISO 8601) — par défaut : now */
  @IsDateString() @IsOptional()
  readingDate?: string;

  /** Source du relevé */
  @IsEnum(OdometerSource) @IsOptional()
  source?: OdometerSource;

  @IsString() @IsOptional()
  note?: string;
}
