import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreatePlatformDto {
  @IsString()
  stationId: string;

  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional() @IsInt() @Min(1)
  capacity?: number;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdatePlatformDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  code?: string;

  @IsOptional() @IsInt() @Min(1)
  capacity?: number;

  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  currentTripId?: string;

  @IsOptional() @IsString()
  notes?: string;
}
