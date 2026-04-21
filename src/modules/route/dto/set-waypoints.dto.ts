import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsNumber, IsOptional, IsString,
  Min, ValidateIf, ValidateNested,
} from 'class-validator';

export enum WaypointKind {
  STATION     = 'STATION',
  PEAGE       = 'PEAGE',
  POLICE      = 'POLICE',
  DOUANE      = 'DOUANE',
  EAUX_FORETS = 'EAUX_FORETS',
  FRONTIERE   = 'FRONTIERE',
  AUTRE       = 'AUTRE',
}

export class CheckpointCostDto {
  @IsString()
  type: string;

  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  costXaf: number;
}

export class WaypointItemDto {
  @IsEnum(WaypointKind)
  @IsOptional()
  kind?: WaypointKind;

  /** Requis si kind = STATION (ou absent — défaut STATION). */
  @ValidateIf(o => !o.kind || o.kind === WaypointKind.STATION)
  @IsString()
  stationId?: string;

  /** Requis si kind ≠ STATION. */
  @ValidateIf(o => o.kind && o.kind !== WaypointKind.STATION)
  @IsString()
  name?: string;

  @IsNumber()
  @Min(1)
  order: number;

  @IsNumber()
  @Min(0)
  distanceFromOriginKm: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  tollCostXaf?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckpointCostDto)
  @IsOptional()
  checkpointCosts?: CheckpointCostDto[];

  @IsBoolean()
  @IsOptional()
  isMandatoryStop?: boolean;

  @IsNumber()
  @IsOptional()
  estimatedWaitTime?: number;
}

export class SetWaypointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WaypointItemDto)
  waypoints: WaypointItemDto[];
}
