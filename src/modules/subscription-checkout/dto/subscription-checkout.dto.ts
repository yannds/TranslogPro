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

/**
 * SetupIntent — enregistrer un moyen de paiement sans déclencher de facturation.
 *
 * Pattern "microcharge + refund auto" : l'orchestrator émet un intent de
 * montant minimal (100 XAF/NGN, 1 USD, 1 EUR) avec `metadata.setupOnly=true`.
 * À la réception du webhook SUCCEEDED, `SubscriptionReconciliationService`
 * détecte le flag, enregistre la carte (tokenRef/last4/brand) dans
 * `externalRefs.savedMethods[]` et déclenche un refund via l'orchestrator.
 *
 * Cas d'usage : le tenant est en statut ACTIVE et veut ajouter/remplacer sa
 * carte avant le prochain renouvellement automatique.
 */
export class StartSetupIntentDto {
  /** Canal de paiement à tokeniser. Mobile Money : on stocke juste le numéro masqué. */
  @IsIn(ALLOWED_METHODS as readonly string[])
  method!: typeof ALLOWED_METHODS[number];

  /** URL de retour après tokenisation. Défaut : `{host}/account?tab=billing&setup=success`. */
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
