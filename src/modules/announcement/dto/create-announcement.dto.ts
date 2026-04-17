import { IsString, IsOptional, IsBoolean, IsInt, IsDateString } from 'class-validator';

export class CreateAnnouncementDto {
  @IsOptional() @IsString()
  stationId?: string;

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsOptional() @IsString()
  type?: string; // INFO | DELAY | CANCELLATION | SECURITY | PROMO | CUSTOM

  @IsOptional() @IsInt()
  priority?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsDateString()
  startsAt?: string;

  @IsOptional() @IsDateString()
  endsAt?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional() @IsString()
  title?: string;

  @IsOptional() @IsString()
  message?: string;

  @IsOptional() @IsString()
  type?: string;

  @IsOptional() @IsInt()
  priority?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsDateString()
  startsAt?: string;

  @IsOptional() @IsDateString()
  endsAt?: string;
}
