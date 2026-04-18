import { IsString, IsOptional, IsNumber, IsEmail, Min } from 'class-validator';

export class CreateParcelDto {
  // ── Destinataire ───────────────────────────────────────────────────────────
  @IsString()
  recipientName: string;

  @IsString()
  recipientPhone: string;

  @IsEmail()
  @IsOptional()
  recipientEmail?: string;   // optionnel — alimente le CRM si fourni

  @IsString()
  @IsOptional()
  address?: string;

  // ── Expéditeur (optionnel — sinon l'acteur authentifié est pris pour sender)
  // Permet au guichet de créer un colis pour un expéditeur tiers anonyme.
  @IsString()
  @IsOptional()
  senderName?: string;

  @IsString()
  @IsOptional()
  senderPhone?: string;

  @IsEmail()
  @IsOptional()
  senderEmail?: string;

  // ── Métadonnées colis ──────────────────────────────────────────────────────
  @IsString()
  destinationId: string;

  @IsNumber() @Min(0)
  weightKg: number;

  @IsNumber() @Min(0)
  @IsOptional()
  declaredValue?: number;
}
