import { IsEmail, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class WaitlistSubmitDto {
  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2,3}$/)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  referrer?: string;

  @IsOptional() @IsString() @MaxLength(128) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(128) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(128) utmCampaign?: string;

  // Honeypot : doit rester vide. Un bot remplit souvent tous les champs visibles.
  @IsOptional()
  @IsString()
  @MaxLength(0)
  company_website?: string;
}
