import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsNumber, IsOptional, IsString,
  Min, ValidateNested,
} from 'class-validator';

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
  @IsString()
  stationId: string;

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
