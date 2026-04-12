import { IsUUID, IsNumber, Min } from 'class-validator';

export class CreateShipmentDto {
  @IsUUID()
  tripId: string;

  @IsUUID()
  destinationId: string;   // FK Station — doit correspondre à Parcel.destinationId

  @IsNumber() @Min(0)
  maxWeightKg: number;     // capacité maximale du groupement
}
