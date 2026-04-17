import { IsString, IsDateString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  routeId: string;

  @IsString()
  @IsNotEmpty()
  busId: string;

  @IsString()
  @IsNotEmpty()
  driverId: string;

  @IsDateString()
  departureTime: string;

  @IsDateString()
  @IsOptional()
  estimatedArrivalTime?: string;

  @IsString()
  @IsOptional()
  agencyId?: string;

  @IsIn(['FREE', 'NUMBERED'])
  @IsOptional()
  seatingMode?: 'FREE' | 'NUMBERED';
}
