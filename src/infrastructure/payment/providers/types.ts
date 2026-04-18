/**
 * IPaymentProvider — contrat étendu au-dessus de IPaymentService.
 *
 * Chaque connecteur concret (MTN MoMo, Airtel, Wave, Flutterwave, Paystack…)
 * implémente IPaymentProvider. Le PaymentProviderRegistry gère le cycle de vie
 * et le PaymentRouter choisit le provider à utiliser pour une opération donnée.
 *
 * Règles :
 *   - `meta` est statique (hardcodé dans le provider), source de vérité au boot
 *     pour la compat ; au runtime l'état effectif (mode, activatedBy…) vit en
 *     DB dans PaymentProviderState (édité par SA plateforme).
 *   - `supports()` DOIT être pure (pas d'I/O) — appelé par le router.
 *   - `healthcheck()` peut faire un appel léger (ping /status), timeout 5s.
 *   - Les secrets ne sont JAMAIS dans l'instance : lecture lazy via Vault.
 */
import {
  IPaymentService,
  PaymentCurrency,
  PaymentMethod,
} from '../interfaces/payment.interface';

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

export interface PaymentProviderMeta {
  /** Identifiant stable unique, ex: 'mtn_momo_cg', 'flutterwave_agg'. */
  key:                 string;
  /** Libellé affiché (fallback si DB indispo). */
  displayName:         string;
  /** Méthodes supportées par ce connecteur. */
  supportedMethods:    PaymentMethod[];
  /** Pays ISO 3166-1 alpha-2. */
  supportedCountries:  string[];
  /** Devises ISO 4217. */
  supportedCurrencies: PaymentCurrency[];
  /** Chemin Vault par défaut (peut être surchargé par PaymentProviderState.vaultPath). */
  defaultVaultPath:    string;
}

export type ProviderMode = 'DISABLED' | 'SANDBOX' | 'LIVE';

export interface ProviderHealth {
  status:    'UP' | 'DOWN' | 'DEGRADED';
  checkedAt: Date;
  latencyMs?: number;
  error?:    string;
}

export interface SupportsQuery {
  country:  string;          // ISO 3166-1 alpha-2
  method:   PaymentMethod;
  currency: PaymentCurrency;
}

export interface IPaymentProvider extends IPaymentService {
  readonly meta: PaymentProviderMeta;
  /**
   * Vrai si le provider est techniquement activable (meta seule, sans DB).
   * Ex : toujours true si le fichier est importé. L'état runtime DB
   * (DISABLED / SANDBOX / LIVE) est vérifié par le registry au-dessus.
   */
  readonly isEnabled: boolean;
  /**
   * Nom (lowercase) du header HTTP portant la signature du webhook.
   * Exemples : 'verif-hash' (Flutterwave), 'x-paystack-signature', 'x-wave-signature'.
   */
  readonly webhookSignatureHeader: string;
  supports(q: SupportsQuery): boolean;
  healthcheck(): Promise<ProviderHealth>;
}
