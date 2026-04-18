import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const ALLOWED_METHODS = ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'USSD'] as const;

export class StartSubscriptionCheckoutDto {
  /** Moyen de paiement souhaité. Carte recommandé pour la récurrence. */
  @IsIn(ALLOWED_METHODS as readonly string[])
  method!: typeof ALLOWED_METHODS[number];

  /** URL de retour après paiement. Défaut : `{host}/welcome?billing=success`. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  redirectUrl?: string;
}

export class UpdateAutoRenewDto {
  @IsBoolean()
  autoRenew!: boolean;
}

export class CancelSubscriptionDto {
  /** Motif optionnel — sert l'analytics de churn. Max 500 chars. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
