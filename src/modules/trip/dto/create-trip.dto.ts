import { IsString, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CreateTripDto {
  @IsUUID()
  routeId: string;

  @IsUUID()
  busId: string;

  @IsUUID()
  driverId: string;

  @IsDateString()
  departureTime: string;

  @IsDateString()
  @IsOptional()
  estimatedArrivalTime?: string;

  @IsUUID()
  @IsOptional()
  agencyId?: string;
}
