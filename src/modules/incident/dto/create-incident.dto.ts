import { IsString, IsEnum, IsOptional, IsBoolean } from 'class-validator';

export enum IncidentType {
  ACCIDENT    = 'ACCIDENT',
  BREAKDOWN   = 'BREAKDOWN',
  THEFT       = 'THEFT',
  DELAY       = 'DELAY',
  PASSENGER   = 'PASSENGER',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  OTHER       = 'OTHER',
}

export enum IncidentSeverity {
  LOW      = 'LOW',
  MEDIUM   = 'MEDIUM',
  HIGH     = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class CreateIncidentDto {
  @IsEnum(IncidentType)
  type: IncidentType;

  @IsEnum(IncidentSeverity)
  severity: IncidentSeverity;

  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  tripId?: string;

  @IsString()
  @IsOptional()
  busId?: string;

  @IsBoolean()
  @IsOptional()
  isSos?: boolean;

  @IsString()
  @IsOptional()
  locationDescription?: string;
}
