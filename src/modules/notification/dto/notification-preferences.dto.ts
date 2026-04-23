import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Patch des préférences notifications de l'utilisateur courant.
 *
 * Tous les champs sont optionnels — seules les valeurs présentes sont
 * mises à jour (PATCH partiel). Aucune autre clé n'est acceptée
 * (`forbidNonWhitelisted` global).
 */
export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;
}
