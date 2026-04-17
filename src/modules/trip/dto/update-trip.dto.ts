import { IsDateString, IsOptional, IsIn, IsString } from 'class-validator';

export class UpdateTripDto {
  @IsString()
  @IsOptional()
  busId?: string;

  @IsString()
  @IsOptional()
  driverId?: string;

  @IsDateString()
  @IsOptional()
  departureTime?: string;

  @IsDateString()
  @IsOptional()
  estimatedArrivalTime?: string;

  @IsIn(['FREE', 'NUMBERED'])
  @IsOptional()
  seatingMode?: 'FREE' | 'NUMBERED';
}
