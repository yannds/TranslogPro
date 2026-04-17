import {
  IsEmail, IsEnum, IsOptional, IsPhoneNumber, IsString,
  MaxLength, ValidateNested,
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

  @ValidateNested()
  @Type(() => PassengerDto)
  passenger!: PassengerDto;

  @IsString()
  @MaxLength(50)
  paymentMethod!: string; // providerId (mtn_momo, airtel_money, card_visa…)
}
