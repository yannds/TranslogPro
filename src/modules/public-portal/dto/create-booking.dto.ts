import {
  IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString,
  MaxLength, ValidateIf, ValidateNested, ArrayMinSize, ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class PassengerDto {
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== '')
  @IsEmail()
  email?: string;

  @IsEnum(['STANDARD', 'VIP'])
  seatType!: 'STANDARD' | 'VIP';

  /** true = le passager souhaite choisir son siège (option payante si seatSelectionFee > 0) */
  @IsOptional()
  @IsBoolean()
  wantsSeatSelection?: boolean;

  /** Siège choisi (ex: "3-2") — requis si wantsSeatSelection=true et seatingMode=NUMBERED */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  seatNumber?: string;
}

export class CreateBookingDto {
  @IsString()
  tripId!: string;

  /** Multi-passenger: tableau de 1-8 passagers */
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @Type(() => PassengerDto)
  passengers!: PassengerDto[];

  @IsString()
  @MaxLength(50)
  paymentMethod!: string; // providerId (mtn_momo, airtel_money, card_visa…)

  /**
   * Gare de montée (segment intermédiaire). Si omis ou égal à route.originId,
   * le billet est vendu au départ de la route. Doit être une station présente
   * sur la route (origin ou waypoint) — validé côté service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  boardingStationId?: string;

  /**
   * Gare de descente (segment intermédiaire). Si omis ou égal à route.destinationId,
   * le billet est vendu jusqu'au terminus. Doit être une station présente sur la
   * route (waypoint ou destination) ET plus loin que boardingStationId — validé service.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alightingStationId?: string;
}
