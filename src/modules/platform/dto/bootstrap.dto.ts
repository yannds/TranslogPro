import { IsEmail, IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class BootstrapDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  /**
   * Token de setup optionnel — si fourni, envoyé à l'email comme magic link.
   * Si absent, un token est généré automatiquement.
   * En production, l'admin recevra un email avec le lien de premier accès.
   */
  @IsString()
  @IsOptional()
  setupToken?: string;
}
