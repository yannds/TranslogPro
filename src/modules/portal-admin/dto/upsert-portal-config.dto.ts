import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class UpsertPortalConfigDto {
  @IsOptional()
  @IsString()
  themeId?: string;

  @IsOptional()
  @IsBoolean()
  showAbout?: boolean;

  @IsOptional()
  @IsBoolean()
  showFleet?: boolean;

  @IsOptional()
  @IsBoolean()
  showNews?: boolean;

  @IsOptional()
  @IsBoolean()
  showContact?: boolean;

  @IsOptional()
  @IsBoolean()
  newsCmsEnabled?: boolean;

  @IsOptional()
  @IsUrl()
  heroImageUrl?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  heroOverlay?: number;

  @IsOptional()
  @IsObject()
  slogans?: Record<string, string>;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;

  @IsOptional()
  @IsUrl()
  ogImageUrl?: string;
}
