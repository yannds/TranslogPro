import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { IsE164Phone } from '../../../common/validators/is-e164-phone.validator';

/**
 * DTO — demande publique d'enlèvement de colis (portail voyageur).
 * Anonyme (pas d'auth), rate-limité par IP côté controller.
 * Les identités sont vérifiées a posteriori par l'agent qui rappelle l'expéditeur.
 */
export class CreateParcelPickupRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  senderName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  @IsE164Phone()
  senderPhone!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(30)
  @IsE164Phone()
  recipientPhone!: string;

  /** Ville de départ (l'agent confirme le rattachement à une agence) */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fromCity!: string;

  /** Ville d'arrivée — résolue côté service en Station */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  toCity!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  /** Poids estimé en kg — optionnel, sera affiné par l'agent au dépôt */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  weightKg?: number;
}
