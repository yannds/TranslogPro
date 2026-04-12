import { IsString, IsInt, IsOptional, Min, IsEnum } from 'class-validator';

export enum BusType {
  STANDARD  = 'STANDARD',
  CONFORT   = 'CONFORT',
  VIP       = 'VIP',
  MINIBUS   = 'MINIBUS',
}

export class CreateBusDto {
  @IsString()
  plateNumber: string;

  @IsEnum(BusType)
  type: BusType;

  @IsInt() @Min(1)
  capacity: number;

  @IsString()
  agencyId: string;

  @IsString() @IsOptional()
  model?: string;

  @IsInt() @IsOptional()
  year?: number;
}
