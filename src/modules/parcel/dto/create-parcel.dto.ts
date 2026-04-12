import { IsString, IsUUID, IsOptional, IsNumber, Min, IsEnum } from 'class-validator';

export enum ParcelSize {
  SMALL  = 'SMALL',
  MEDIUM = 'MEDIUM',
  LARGE  = 'LARGE',
  EXTRA  = 'EXTRA',
}

export class CreateParcelDto {
  @IsString()
  senderName: string;

  @IsString()
  senderPhone: string;

  @IsString()
  recipientName: string;

  @IsString()
  recipientPhone: string;

  @IsUUID()
  originId: string;

  @IsUUID()
  destinationId: string;

  @IsUUID()
  @IsOptional()
  tripId?: string;

  @IsEnum(ParcelSize)
  size: ParcelSize;

  @IsNumber() @Min(0)
  weightKg: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber() @Min(0)
  @IsOptional()
  declaredValue?: number;
}
