import { IsEmail, IsString, IsNotEmpty, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * SignInCrossTenantDto — sign-in où l'utilisateur ne fournit pas son tenant.
 *
 * Contient tous les champs de SignInDto + un slug optionnel pour résoudre
 * le cas (rare) où la même adresse a un compte sur plusieurs tenants.
 */
export class SignInCrossTenantDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Mot de passe requis' })
  @MinLength(8,   { message: 'Mot de passe trop court (min 8 caractères)' })
  @MaxLength(128, { message: 'Mot de passe trop long' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;

  /**
   * Slug tenant explicite — utilisé en 2e étape quand le serveur a renvoyé
   * `multiple: true` pour lever l'ambiguïté (le même email a un compte sur
   * plusieurs tenants avec le même password).
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/, {
    message: 'Slug tenant invalide (a-z0-9, tirets, max 64 chars)',
  })
  preferredTenantSlug?: string;
}
