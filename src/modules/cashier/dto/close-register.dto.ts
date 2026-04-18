import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseRegisterDto {
  /**
   * Montant physique compté par l'agent/superviseur à la clôture.
   * Permet le rapprochement : écart = countedBalance - finalBalance théorique.
   */
  @IsOptional() @IsNumber() @Min(0)
  countedBalance?: number;

  @IsOptional() @IsString()
  closingNote?: string;
}
