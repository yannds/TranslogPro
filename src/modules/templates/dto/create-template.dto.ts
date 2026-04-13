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
  PDFME     = 'PDFME',
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

  /** Schéma pdfme JSON (engine=PDFME). */
  @IsObject()
  @IsOptional()
  schemaJson?: Record<string, unknown>;

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

  /** Mise à jour du schéma pdfme (engine=PDFME). */
  @IsObject()
  @IsOptional()
  schemaJson?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  varsSchema?: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/** DTO pour dupliquer un template système et le personnaliser. */
export class DuplicateTemplateDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  slug?: string;
}
