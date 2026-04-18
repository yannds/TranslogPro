import { IsString, IsNumber, Min, IsOptional } from 'class-validator';

export class OpenRegisterDto {
  @IsString()
  agencyId: string;

  @IsNumber() @Min(0)
  openingBalance: number;

  @IsOptional() @IsString()
  note?: string;
}
