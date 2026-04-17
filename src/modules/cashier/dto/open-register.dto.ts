import { IsString, IsNumber, Min } from 'class-validator';

export class OpenRegisterDto {
  @IsString()
  agencyId: string;

  @IsNumber() @Min(0)
  openingBalance: number;
}
