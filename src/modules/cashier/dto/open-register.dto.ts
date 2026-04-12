import { IsUUID, IsNumber, Min } from 'class-validator';

export class OpenRegisterDto {
  @IsUUID()
  agencyId: string;

  @IsNumber() @Min(0)
  openingBalance: number;
}
