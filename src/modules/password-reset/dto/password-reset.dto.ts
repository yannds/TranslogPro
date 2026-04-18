import { IsEmail, IsString, IsNotEmpty, MaxLength, MinLength, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class RequestPasswordResetDto {
  @IsEmail({}, { message: 'Adresse e-mail invalide' })
  @MaxLength(254)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.toLowerCase().trim() : value)
  email!: string;
}

export class CompletePasswordResetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Mot de passe trop court (min 8 caractères)' })
  @MaxLength(128)
  newPassword!: string;
}

export class AdminInitiateResetDto {
  @IsIn(['link', 'set'], { message: 'Mode invalide : link | set' })
  mode!: 'link' | 'set';

  /** Requis uniquement si mode === 'set'. Ignoré sinon. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Mot de passe trop court (min 8 caractères)' })
  @MaxLength(128)
  newPassword?: string;
}

export class BatchUserIdsDto {
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  userIds!: string[];
}
