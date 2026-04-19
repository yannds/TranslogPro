import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateSubscriptionDto {
  @IsString()
  tenantId!: string;

  @IsString()
  planId!: string;

  @IsOptional()
  @IsString()
  status?: string; // TRIAL | ACTIVE — par défaut TRIAL si trialDays > 0 sinon ACTIVE

  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @IsOptional()
  @IsDateString()
  currentPeriodStart?: string;

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;
}

export class ChangeSubscriptionPlanDto {
  @IsString()
  planId!: string;
}

/**
 * Prolongation de période d'essai — soit ajouter N jours à la date d'expiration
 * actuelle (ou `now` si expirée/absente), soit fixer explicitement une nouvelle
 * date. Exactement UN des deux champs doit être fourni (validation applicative).
 */
export class ExtendTrialDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  days?: number;

  @IsOptional()
  @IsDateString()
  trialEndsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateSubscriptionStatusDto {
  @IsString()
  status!: string; // TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string;
}

export class CreateInvoiceDto {
  @IsString()
  subscriptionId!: string;

  @IsDateString()
  periodStart!: string;

  @IsDateString()
  periodEnd!: string;

  @IsNumber()
  @Min(0)
  subtotal!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  lineItems?: unknown[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class MarkInvoicePaidDto {
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  paymentRef?: string;
}
