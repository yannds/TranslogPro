/**
 * IPaymentService — Port d'abstraction pour les passerelles de paiement.
 *
 * Implémentations :
 *   FlutterwaveService  → Afrique de l'Ouest/Est (Mobile Money, cartes)
 *   PaystackService     → Nigeria, Ghana, Kenya (cartes, Mobile Money)
 *
 * Toutes les interactions avec les providers utilisent UNIQUEMENT cette interface.
 * Aucun import direct de SDK tiers dans le code métier — PRD §II.2.
 */

export const PAYMENT_SERVICE = 'IPaymentService';

// ─── Enums ────────────────────────────────────────────────────────────────────

export type PaymentCurrency = 'XOF' | 'XAF' | 'NGN' | 'GHS' | 'KES' | 'USD';
export type PaymentMethod   = 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'USSD';
export type PaymentStatus   =
  | 'PENDING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface InitiatePaymentDto {
  /** Référence idempotente — si déjà traitée, retourne le résultat existant */
  txRef:        string;
  amount:       number;
  currency:     PaymentCurrency;
  method:       PaymentMethod;
  /** Numéro Mobile Money ou email carte */
  customerPhone?: string;
  customerEmail?: string;
  customerName?:  string;
  /** URL de redirection après paiement (flow redirect) */
  redirectUrl?:   string;
  /** Métadonnées libres (ticketId, tenantId, etc.) */
  meta?:          Record<string, string>;
}

export interface PaymentResult {
  txRef:          string;
  externalRef:    string;   // ID provider (Flutterwave transaction_id, Paystack reference)
  status:         PaymentStatus;
  amount:         number;
  currency:       PaymentCurrency;
  providerName:   string;   // 'flutterwave' | 'paystack'
  /** URL de paiement à rediriger le client (paiement asynchrone) */
  paymentUrl?:    string;
  processedAt?:   Date;
}

export interface WebhookVerificationResult {
  isValid:        boolean;
  txRef:          string;
  externalRef:    string;
  status:         PaymentStatus;
  amount:         number;
  currency:       PaymentCurrency;
  meta?:          Record<string, unknown>;
}

export interface RefundDto {
  externalRef: string;     // ID transaction provider
  amount?:     number;     // montant partiel ou total si absent
  reason:      string;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IPaymentService {
  /**
   * Initie un paiement. Peut retourner une paymentUrl (redirect) ou
   * déclencher directement l'encaissement (Mobile Money push).
   */
  initiate(dto: InitiatePaymentDto): Promise<PaymentResult>;

  /**
   * Vérifie le statut d'une transaction par sa référence provider.
   * À utiliser pour le polling ou après réception d'un webhook.
   */
  verify(externalRef: string): Promise<PaymentResult>;

  /**
   * Valide la signature HMAC d'un webhook entrant.
   * Retourne le résultat parsé si valide, lève une exception sinon.
   *
   * @param rawBody  Corps brut de la requête (Buffer) — NE PAS parser avant vérification
   * @param signature Header de signature du provider
   */
  verifyWebhook(
    rawBody:   Buffer,
    signature: string,
  ): Promise<WebhookVerificationResult>;

  /**
   * Initie un remboursement (total ou partiel).
   */
  refund(dto: RefundDto): Promise<PaymentResult>;
}
