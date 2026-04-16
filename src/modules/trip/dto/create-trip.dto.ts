import { IsString, IsDateString, IsNotEmpty, IsOptional } from 'class-validator';

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
}
