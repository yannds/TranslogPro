import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchTripsDto {
  @IsString()
  @MaxLength(100)
  departure!: string;

  @IsString()
  @MaxLength(100)
  arrival!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  passengers?: number;
}
