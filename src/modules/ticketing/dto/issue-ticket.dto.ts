import { IsString, IsUUID, IsOptional, IsInt, IsEnum, Min } from 'class-validator';

export enum FareClass {
  STANDARD = 'STANDARD',
  CONFORT  = 'CONFORT',
  VIP      = 'VIP',
  STANDING = 'STANDING',
}

export class IssueTicketDto {
  @IsUUID()
  tripId: string;

  @IsString()
  passengerName: string;

  @IsString()
  passengerPhone: string;

  @IsEnum(FareClass)
  fareClass: FareClass;

  @IsUUID()
  @IsOptional()
  boardingStationId?: string;   // défaut = route.originId

  @IsUUID()
  alightingStationId: string;   // obligatoire — gare de descente

  @IsString()
  @IsOptional()
  seatNumber?: string;

  @IsInt() @Min(0)
  @IsOptional()
  luggageKg?: number;

  @IsString()
  @IsOptional()
  discountCode?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}
