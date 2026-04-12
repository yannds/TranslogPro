import { IsString, IsUUID, IsOptional, IsNumber, Min } from 'class-validator';

export class CreateParcelDto {
  @IsString()
  recipientName: string;

  @IsString()
  recipientPhone: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsUUID()
  destinationId: string;

  @IsNumber() @Min(0)
  weightKg: number;

  @IsNumber() @Min(0)
  @IsOptional()
  declaredValue?: number;
}
