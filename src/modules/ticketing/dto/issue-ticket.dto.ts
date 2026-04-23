import { IsString, IsOptional, IsInt, IsNumber, IsEnum, IsBoolean, IsArray, IsEmail, ValidateNested, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

export enum FareClass {
  STANDARD = 'STANDARD',
  CONFORT  = 'CONFORT',
  VIP      = 'VIP',
  STANDING = 'STANDING',
}

export class IssueTicketDto {
  @IsString()
  tripId: string;

  @IsString()
  passengerName: string;

  @IsString()
  passengerPhone: string;

  @IsEmail()
  @IsOptional()
  passengerEmail?: string;   // optionnel — alimente le CRM si fourni

  @IsEnum(FareClass)
  fareClass: FareClass;

  @IsString()
  @IsOptional()
  boardingStationId?: string;   // défaut = route.originId

  @IsString()
  alightingStationId: string;   // obligatoire — gare de descente

  @IsString()
  @IsOptional()
  seatNumber?: string;

  @IsBoolean()
  @IsOptional()
  wantsSeatSelection?: boolean; // true = le passager paie l'option choix de siège

  @IsInt() @Min(0)
  @IsOptional()
  luggageKg?: number;

  @IsString()
  @IsOptional()
  discountCode?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;
}

// ── Batch (achat groupé) ─────────────────────────────────────────────────────

export class BatchPassengerDto {
  @IsString()
  passengerName: string;

  @IsString()
  passengerPhone: string;

  @IsEmail()
  @IsOptional()
  passengerEmail?: string;   // optionnel — alimente le CRM si fourni

  @IsEnum(FareClass)
  fareClass: FareClass;

  @IsString()
  @IsOptional()
  boardingStationId?: string;

  @IsString()
  alightingStationId: string;

  @IsString()
  @IsOptional()
  seatNumber?: string;

  @IsBoolean()
  @IsOptional()
  wantsSeatSelection?: boolean;

  @IsInt() @Min(0)
  @IsOptional()
  luggageKg?: number;
}

export class IssueBatchDto {
  @IsString()
  tripId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchPassengerDto)
  @ArrayMinSize(1)
  passengers: BatchPassengerDto[];

  @IsString()
  @IsOptional()
  discountCode?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  /**
   * Si true, `pricingSummary` inclura les taxes non appliquées (enabled mais
   * `appliedToPrice=false` globalement ou au niveau ligne) avec `applied=false`
   * et leur montant calculé, pour l'affichage pédagogique côté caissier
   * (grisé "serait X XOF"). N'affecte pas le total facturé.
   */
  @IsOptional()
  explainTaxes?: boolean;
}

export class ConfirmBatchDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  ticketIds: string[];

  /**
   * Moyen de règlement effectif — alimente la Transaction caisse pour la
   * traçabilité. Valeurs : CASH | MOBILE_MONEY | CARD | BANK_TRANSFER | VOUCHER | MIXED.
   * Défaut CASH si non fourni (caisse physique).
   */
  @IsString() @IsOptional()
  paymentMethod?: string;

  /**
   * Si présent : enregistre la vente dans la caisse ouverte indiquée.
   * Sinon : on tente la caisse ouverte de l'acteur automatiquement.
   * Passer explicitement `null` désactive l'enregistrement (achat portail/paiement en ligne).
   */
  @IsString() @IsOptional()
  cashRegisterId?: string | null;

  /**
   * Référence externe (PaymentAttempt externalRef, reçu MoMo, bordereau…)
   * — garantit l'idempotence au niveau Transaction.
   */
  @IsString() @IsOptional()
  externalRef?: string;

  /**
   * Espèces uniquement : total remis par le client pour le batch.
   * Doit couvrir la somme du batch. Le backend calcule la monnaie rendue
   * (changeAmount) et la stocke sur la première Transaction du batch.
   */
  @IsNumber() @Min(0) @IsOptional()
  tenderedAmount?: number;

  /**
   * Preuve paiement hors-POS saisie par le caissier (MoMo/Wave/Airtel/carte/
   * virement/voucher/QR). Propagé sur chaque Transaction du batch.
   */
  @IsString() @IsOptional()
  proofCode?: string;

  @IsString() @IsOptional()
  proofType?: string;
}
