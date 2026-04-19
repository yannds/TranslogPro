/**
 * StripeProvider — Cartes bancaires internationales (marché global).
 *
 * Flow : Stripe Checkout Session (hosted page PCI SAQ-A, aucun champ carte
 * ne transite par nos serveurs). On crée une session, on redirige l'user sur
 * `session.url`, Stripe nous webhook avec l'événement `checkout.session.completed`
 * une fois le paiement validé.
 *
 * Tokenisation native :
 *   - `customer` (ID Stripe "cus_xxx") stocké pour charges récurrentes
 *   - `payment_intent.payment_method` retourne la card method (pm_xxx)
 *   - `charges.data[0].payment_method_details.card.{last4, brand}` pour UI
 *
 * Sécurité :
 *   - API_KEY + WEBHOOK_SECRET via Vault (jamais process.env)
 *   - Webhook vérifié par signature Stripe-Signature (HMAC-SHA256 tolérance 5 min)
 *   - customerRef propagé dans PaymentResult pour auto-renew sans interaction
 *
 * Doc : https://docs.stripe.com/api/checkout/sessions
 */
import {
  Inject, Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  InitiatePaymentDto,
  PaymentResult,
  PaymentStatus,
  RefundDto,
  WebhookVerificationResult,
} from '../interfaces/payment.interface';
import { ISecretService, SECRET_SERVICE } from '../../secret/interfaces/secret.interface';
import {
  IPaymentProvider,
  PaymentProviderMeta,
  ProviderHealth,
  SupportsQuery,
} from './types';

const VAULT_PATH          = 'platform/payments/stripe';
const API_BASE_URL        = 'https://api.stripe.com/v1';
const HTTP_TIMEOUT_MS     = 15_000;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1_000;
const WEBHOOK_TOLERANCE_SECONDS = 300; // 5 min — valeur standard Stripe

// Stripe utilise la sous-unité (centimes) pour toutes les devises fiat.
// Pour USD/EUR : 1 $ → 100. Pour XOF/XAF/KES (zero-decimal) : 1 XOF → 1.
// Source : https://docs.stripe.com/currencies#zero-decimal
const ZERO_DECIMAL = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','UGX','VND','VUV','XAF','XOF','XPF']);

interface StripeCredentials {
  API_KEY:        string; // sk_live_... ou sk_test_...
  WEBHOOK_SECRET: string; // whsec_...
}

@Injectable()
export class StripeProvider implements IPaymentProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private readonly http: AxiosInstance;
  private creds: StripeCredentials | null = null;
  private credsCachedAt = 0;

  readonly meta: PaymentProviderMeta = {
    key:                 'stripe',
    displayName:         'Stripe (Card international)',
    supportedMethods:    ['CARD'],
    // Stripe est multi-pays mais on limite à ce que le reste de l'app connaît
    // + quelques marchés EU/US pour les tenants internationaux.
    supportedCountries:  ['FR','BE','US','GB','DE','ES','PT','IT','NL','SN','CI','GH','NG','KE'],
    supportedCurrencies: ['USD','XOF','GHS','KES','NGN'],
    defaultVaultPath:    VAULT_PATH,
  };

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({
      baseURL: API_BASE_URL,
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  get isEnabled(): boolean { return true; }
  readonly webhookSignatureHeader = 'stripe-signature';

  supports(q: SupportsQuery): boolean {
    return this.meta.supportedMethods.includes(q.method)
        && this.meta.supportedCountries.includes(q.country)
        && this.meta.supportedCurrencies.includes(q.currency);
  }

  async healthcheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { API_KEY } = await this.getCreds();
      // Balance endpoint — low-cost read, requires only the secret key.
      await this.http.get('/balance', { headers: { Authorization: `Bearer ${API_KEY}` } });
      return { status: 'UP', checkedAt: new Date(), latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'DOWN', checkedAt: new Date(), latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const { API_KEY } = await this.getCreds();
    const minorUnits = this.toMinor(dto.amount, dto.currency);
    const form = new URLSearchParams();
    form.append('mode',                    'payment');
    form.append('payment_method_types[]',  'card');
    form.append('line_items[0][price_data][currency]',              dto.currency.toLowerCase());
    form.append('line_items[0][price_data][product_data][name]',    `TransLog Pro — ${dto.txRef}`);
    form.append('line_items[0][price_data][unit_amount]',           String(minorUnits));
    form.append('line_items[0][quantity]',                          '1');
    form.append('client_reference_id',     dto.txRef);
    if (dto.customerEmail) form.append('customer_email', dto.customerEmail);
    if (dto.redirectUrl) {
      form.append('success_url', `${dto.redirectUrl}?session_id={CHECKOUT_SESSION_ID}`);
      form.append('cancel_url',  dto.redirectUrl);
    }
    // Meta propagée jusqu'au webhook → utile pour reconciliation cross-tenant.
    if (dto.meta) {
      for (const [k, v] of Object.entries(dto.meta)) {
        form.append(`metadata[${k}]`, String(v));
      }
    }
    // IMPORTANT : force la création d'un Customer Stripe pour pouvoir réutiliser
    // la méthode sur les renouvellements (sans ça `customer` reste null).
    form.append('customer_creation', 'always');

    try {
      const { data } = await this.http.post('/checkout/sessions', form.toString(), {
        headers: {
          Authorization:     `Bearer ${API_KEY}`,
          'Idempotency-Key': dto.txRef,  // natif Stripe — évite le double checkout
        },
      });
      this.logger.log(`[Stripe] session created id=${data.id} tx_ref=${dto.txRef}`);
      return {
        txRef:        dto.txRef,
        externalRef:  String(data.id),
        status:       'PENDING',
        amount:       dto.amount,
        currency:     dto.currency,
        providerName: this.meta.key,
        paymentUrl:   data.url,
      };
    } catch (err) {
      const msg = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : String(err);
      this.logger.error(`[Stripe] initiate failed: ${msg}`);
      throw new Error(`Stripe initiate failed: ${msg}`);
    }
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const { API_KEY } = await this.getCreds();
    // On expand payment_intent.charges.data.payment_method_details pour obtenir
    // la carte (brand, last4). Plus cher en bandwidth, mais indispensable pour
    // la tokenisation UI.
    const { data } = await this.http.get(
      `/checkout/sessions/${externalRef}?expand[]=payment_intent.charges.data.payment_method_details`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    );
    const pi         = data.payment_intent ?? {};
    const charge     = pi.charges?.data?.[0] ?? {};
    const card       = charge.payment_method_details?.card ?? {};
    const amount     = this.fromMinor(Number(pi.amount ?? data.amount_total ?? 0), data.currency);
    return {
      txRef:        String(data.client_reference_id ?? externalRef),
      externalRef,
      status:       this.mapStatus(data.payment_status),
      amount,
      currency:     String(data.currency ?? 'usd').toUpperCase() as PaymentResult['currency'],
      providerName: this.meta.key,
      processedAt:  pi.created ? new Date(pi.created * 1000) : undefined,
      customerRef:  data.customer ? String(data.customer)           : undefined,
      methodToken:  pi.payment_method ? String(pi.payment_method)   : undefined,
      methodLast4:  card.last4,
      methodBrand:  card.brand,
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const { WEBHOOK_SECRET } = await this.getCreds();
    // Format Stripe : "t=<ts>,v1=<hex>,v0=<hex>" — on vérifie v1 (HMAC-SHA256).
    const parsed = Object.fromEntries(
      signature.split(',').map(p => p.split('=') as [string, string]),
    );
    const timestamp = Number(parsed.t);
    const v1        = parsed.v1;
    if (!timestamp || !v1) throw new UnauthorizedException('Stripe signature malformée');
    if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new UnauthorizedException('Stripe webhook hors fenêtre de tolérance');
    }
    const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
    const computed      = createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex');
    const a = Buffer.from(v1, 'hex');
    const b = Buffer.from(computed, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('[Stripe] webhook signature mismatch');
      throw new UnauthorizedException('Invalid Stripe webhook signature');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const obj   = event.data?.object ?? {};
    // On ne traite que les événements checkout pertinents : `checkout.session.completed`
    // (success) et `checkout.session.expired` (expired → FAILED).
    const status: PaymentStatus =
      event.type === 'checkout.session.completed' ? 'SUCCESSFUL' :
      event.type === 'checkout.session.expired'   ? 'CANCELLED'  :
      'PENDING';

    // Les refs de card ne sont pas dans le webhook directement — il faut un
    // fetch pour les avoir. Pour respecter le budget latence webhook (<1s),
    // on laisse la récupération au prochain cycle via verify() si besoin.
    return {
      isValid:     true,
      txRef:       String(obj.client_reference_id ?? ''),
      externalRef: String(obj.id ?? ''),
      status,
      amount:      this.fromMinor(Number(obj.amount_total ?? 0), obj.currency),
      currency:    String(obj.currency ?? 'usd').toUpperCase() as WebhookVerificationResult['currency'],
      meta:        (obj.metadata ?? {}) as Record<string, unknown>,
      customerRef: obj.customer ? String(obj.customer) : undefined,
      // `payment_method` n'est pas exposé sur Session dans le webhook ; on
      // l'obtient via verify() post-webhook. last4/brand idem.
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const { API_KEY } = await this.getCreds();
    // Pour Stripe, `externalRef` reçu ici est l'ID Session — on doit retrouver
    // le payment_intent derrière pour créer le refund.
    const { data: session } = await this.http.get(
      `/checkout/sessions/${dto.externalRef}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    );
    const piId = session.payment_intent;
    if (!piId) throw new Error(`Stripe refund: session ${dto.externalRef} n'a pas de payment_intent`);

    const form = new URLSearchParams();
    form.append('payment_intent', String(piId));
    if (dto.amount !== undefined) {
      form.append('amount', String(this.toMinor(dto.amount, session.currency ?? 'USD')));
    }
    if (dto.reason) form.append('metadata[reason]', dto.reason);

    const { data } = await this.http.post('/refunds', form.toString(), {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    return {
      txRef:        String(session.client_reference_id ?? dto.externalRef),
      externalRef:  dto.externalRef,
      status:       'REVERSED',
      amount:       this.fromMinor(Number(data.amount ?? 0), data.currency ?? 'USD'),
      currency:     String(data.currency ?? 'usd').toUpperCase() as PaymentResult['currency'],
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private mapStatus(s: string): PaymentStatus {
    if (s === 'paid')     return 'SUCCESSFUL';
    if (s === 'unpaid')   return 'PENDING';
    if (s === 'no_payment_required') return 'SUCCESSFUL';
    return 'PENDING';
  }

  private toMinor(amount: number, currency: string): number {
    return ZERO_DECIMAL.has(currency.toUpperCase())
      ? Math.round(amount)
      : Math.round(amount * 100);
  }

  private fromMinor(minor: number, currency: string): number {
    return ZERO_DECIMAL.has((currency ?? '').toUpperCase())
      ? minor
      : minor / 100;
  }

  private async getCreds(): Promise<StripeCredentials> {
    const now = Date.now();
    if (this.creds && now - this.credsCachedAt < SECRET_CACHE_TTL_MS) return this.creds;
    const raw = await this.secretService.getSecretObject<StripeCredentials>(VAULT_PATH);
    if (!raw?.API_KEY || !raw?.WEBHOOK_SECRET) {
      throw new Error(`Stripe secrets missing in Vault (${VAULT_PATH})`);
    }
    this.creds = raw;
    this.credsCachedAt = now;
    return this.creds;
  }
}
