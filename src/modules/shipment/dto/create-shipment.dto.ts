import { IsString, IsNumber, Min } from 'class-validator';

export class CreateShipmentDto {
  @IsString()
  tripId: string;

  @IsString()
  destinationId: string;   // FK Station — doit correspondre à Parcel.destinationId

  @IsNumber() @Min(0)
  maxWeightKg: number;     // capacité maximale du groupement
}
