import { IsEmail, IsHexColor, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertBrandDto {
  @IsString()
  @MaxLength(100)
  brandName!: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsUrl()
  faviconUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsHexColor()
  accentColor?: string;

  @IsOptional()
  @IsHexColor()
  textColor?: string;

  @IsOptional()
  @IsHexColor()
  bgColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  fontFamily?: string;

  /** CSS additionnel — sanitisé côté service avant injection */
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  customCss?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaDescription?: string;

  @IsOptional()
  @IsString()
  supportEmail?: string;

  @IsOptional()
  @IsString()
  supportPhone?: string;

  // ─── Identité d'envoi email transactionnel ────────────────────────────────
  // Affiché au destinataire. Pas un secret. Si null, fallback au default
  // plateforme (FROM_EMAIL / FROM_NAME des services email).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  emailFromName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  emailFromAddress?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  emailReplyTo?: string;
}
