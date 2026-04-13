import { IsString, IsEnum, IsOptional, IsBoolean, IsObject } from 'class-validator';

export enum DocType {
  TICKET       = 'TICKET',
  MANIFEST     = 'MANIFEST',
  INVOICE      = 'INVOICE',
  LABEL        = 'LABEL',
  PACKING_LIST = 'PACKING_LIST',
}

export enum TemplateFormat {
  A4           = 'A4',
  A5           = 'A5',
  THERMAL_80MM = 'THERMAL_80MM',
  LABEL_62MM   = 'LABEL_62MM',
  ENVELOPE_C5  = 'ENVELOPE_C5',
  BAGGAGE_TAG  = 'BAGGAGE_TAG',
}

export enum TemplateEngine {
  HBS       = 'HBS',
  PUPPETEER = 'PUPPETEER',
}

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsEnum(DocType)
  docType: DocType;

  @IsEnum(TemplateFormat)
  format: TemplateFormat;

  @IsEnum(TemplateEngine)
  @IsOptional()
  engine?: TemplateEngine;

  /** Corps du template inline (Handlebars). Mutuellement exclusif avec storageKey. */
  @IsString()
  @IsOptional()
  body?: string;

  @IsObject()
  @IsOptional()
  varsSchema?: Record<string, unknown>;
}

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsObject()
  @IsOptional()
  varsSchema?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
