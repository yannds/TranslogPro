import { IsString, IsNumber, Min, IsOptional } from 'class-validator';

export class OpenRegisterDto {
  /**
   * Agence de rattachement. Optionnel — si absent, le backend résout depuis
   * Staff.agencyId de l'acteur (mobile cashier qui n'a pas toujours l'info
   * en session, ex. Staff créé sans agencyId ou après changement de poste).
   */
  @IsOptional() @IsString()
  agencyId?: string;

  @IsNumber() @Min(0)
  openingBalance: number;

  @IsOptional() @IsString()
  note?: string;
}
