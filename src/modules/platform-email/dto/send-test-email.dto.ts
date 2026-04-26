/**
 * DTO du test d'envoi d'email depuis la plateforme.
 *
 * Validation côté backend (class-validator) :
 *   - templateId  : doit appartenir au catalogue (validé par la service contre
 *                   getKnownTemplateIds() — pas en DTO pour rester DRY).
 *   - toEmail     : email RFC 5322 valide.
 *   - toName      : 1-120 chars (le nom remplace recipientNameVar dans les vars).
 *   - lang        : 'fr' | 'en' (défaut fr côté service si omis).
 *   - extraVars   : surcharge libre des sampleVars du descripteur.
 */

import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, IsObject } from 'class-validator';

export class SendTestEmailDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  templateId!: string;

  @IsEmail()
  toEmail!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  toName!: string;

  @IsOptional()
  @IsIn(['fr', 'en'])
  lang?: 'fr' | 'en';

  @IsOptional()
  @IsObject()
  extraVars?: Record<string, string>;
}
