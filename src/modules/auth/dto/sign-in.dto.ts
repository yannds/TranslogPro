import { IsEmail, IsString, IsNotEmpty, IsOptional, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * SignInDto — validation stricte des credentials entrants.
 *
 * Sécurité :
 *   - @IsEmail() : rejet des payloads malformés avant tout traitement DB
 *   - MaxLength  : prévient les DoS par payload surdimensionné (bcrypt timing)
 *   - Transform  : normalisation email en lowercase (prévient l'énumération case-sensitive)
 *   - whitelist + forbidNonWhitelisted activés globalement (ValidationPipe dans main.ts)
 *     → tout champ non déclaré ici est rejeté avec 400
 */
export class SignInDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(254, { message: 'Email trop long' })   // RFC 5321 max
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Mot de passe requis' })
  @MinLength(8,   { message: 'Mot de passe trop court (min 8 caractères)' })
  @MaxLength(128, { message: 'Mot de passe trop long' })
  password!: string;

  /**
   * Token CAPTCHA (Cloudflare Turnstile) — optionnel. Exigé UNIQUEMENT si
   * AuthService détecte N échecs d'auth récents (par IP OU par email).
   * En nominal, un user légitime n'envoie jamais ce champ.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
}
