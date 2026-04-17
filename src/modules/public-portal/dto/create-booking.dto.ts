import {
  IsArray, IsEmail, IsEnum, IsOptional, IsString,
  MaxLength, ValidateNested, ArrayMinSize, ArrayMaxSize,
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
  @IsEmail()
  email?: string;

  @IsEnum(['STANDARD', 'VIP'])
  seatType!: 'STANDARD' | 'VIP';
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
}
