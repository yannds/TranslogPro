/**
 * PaystackAggregatorProvider — Nigeria / Ghana / Kenya / Afrique du Sud.
 *
 * Vault path : platform/payments/paystack_agg
 * Doc       : https://paystack.com/docs/api/
 *
 * Sécurité : webhook HMAC-SHA512 temps constant, secret unique SECRET_KEY.
 */
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
import { IPaymentProvider, PaymentProviderMeta, ProviderHealth, SupportsQuery } from './types';

const VAULT_PATH      = 'platform/payments/paystack_agg';
const API_BASE_URL    = 'https://api.paystack.co';
const HTTP_TIMEOUT_MS = 15_000;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1_000;
const AMOUNT_SUBUNIT_MULTIPLIER = 100; // Paystack en kobo/pesewas

@Injectable()
export class PaystackAggregatorProvider implements IPaymentProvider {
  private readonly logger = new Logger(PaystackAggregatorProvider.name);
  private readonly http: AxiosInstance;
  private secretKey: string | null = null;
  private keyCachedAt = 0;

  readonly meta: PaymentProviderMeta = {
    key:                 'paystack_agg',
    displayName:         'Paystack (Aggregator)',
    supportedMethods:    ['CARD', 'BANK_TRANSFER', 'MOBILE_MONEY'],
    supportedCountries:  ['NG', 'GH', 'ZA', 'KE'],
    supportedCurrencies: ['NGN', 'GHS', 'KES', 'USD'],
    defaultVaultPath:    VAULT_PATH,
  };

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({ baseURL: API_BASE_URL, timeout: HTTP_TIMEOUT_MS });
  }

  get isEnabled(): boolean { return true; }
  readonly webhookSignatureHeader = 'x-paystack-signature';

  supports(q: SupportsQuery): boolean {
    return this.meta.supportedMethods.includes(q.method)
        && this.meta.supportedCountries.includes(q.country)
        && this.meta.supportedCurrencies.includes(q.currency);
  }

  async healthcheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const key = await this.getSecretKey();
      await this.http.get('/bank?country=nigeria', { headers: { Authorization: `Bearer ${key}` } });
      return { status: 'UP', checkedAt: new Date(), latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'DOWN', checkedAt: new Date(), latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();
    const { data } = await this.http.post(
      '/transaction/initialize',
      {
        reference:    dto.txRef,
        amount:       Math.round(dto.amount * AMOUNT_SUBUNIT_MULTIPLIER),
        currency:     dto.currency,
        email:        dto.customerEmail ?? `${dto.txRef}@translogpro.noreply`,
        callback_url: dto.redirectUrl,
        metadata:     { ...dto.meta, custom_fields: [] },
      },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return {
      txRef:        dto.txRef,
      externalRef:  data.data?.reference ?? dto.txRef,
      status:       'PENDING',
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: this.meta.key,
      paymentUrl:   data.data?.authorization_url,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const key = await this.getSecretKey();
    const { data } = await this.http.get(`/transaction/verify/${externalRef}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const tx = data.data;
    // Tokenisation Paystack :
    //   - tx.customer.customer_code      → customerRef (durable, format "CUS_xxx")
    //   - tx.authorization.authorization_code → methodToken (pour charge_authorization)
    //   - tx.authorization.last4          → methodLast4
    //   - tx.authorization.card_type      → methodBrand ("visa", "mastercard"…)
    return {
      txRef:        tx.reference,
      externalRef,
      status:       tx.status === 'success' ? 'SUCCESSFUL' : 'FAILED',
      amount:       tx.amount / AMOUNT_SUBUNIT_MULTIPLIER,
      currency:     tx.currency,
      providerName: this.meta.key,
      processedAt:  tx.paid_at ? new Date(tx.paid_at) : undefined,
      customerRef:  tx.customer?.customer_code,
      methodToken:  tx.authorization?.authorization_code,
      methodLast4:  tx.authorization?.last4,
      methodBrand:  tx.authorization?.card_type,
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const key = await this.getSecretKey();
    const computed = createHmac('sha512', key).update(rawBody).digest('hex');
    const sig  = Buffer.from(signature, 'hex');
    const comp = Buffer.from(computed,  'hex');
    if (sig.length !== comp.length || !timingSafeEqual(sig, comp)) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const tx   = body['data'] as Record<string, unknown>;
    const customer = tx['customer']      as Record<string, unknown> | undefined;
    const auth     = tx['authorization'] as Record<string, unknown> | undefined;
    return {
      isValid:     true,
      txRef:       String(tx['reference'] ?? ''),
      externalRef: String(tx['id']        ?? ''),
      status:      (tx['status'] === 'success') ? 'SUCCESSFUL' : 'FAILED',
      amount:      Number(tx['amount'] ?? 0) / AMOUNT_SUBUNIT_MULTIPLIER,
      currency:    String(tx['currency'] ?? 'NGN') as WebhookVerificationResult['currency'],
      customerRef: customer?.['customer_code']       ? String(customer['customer_code']) : undefined,
      methodToken: auth?.['authorization_code']      ? String(auth['authorization_code']) : undefined,
      methodLast4: auth?.['last4']                   ? String(auth['last4']) : undefined,
      methodBrand: auth?.['card_type']               ? String(auth['card_type']) : undefined,
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();
    await this.http.post(
      '/refund',
      { transaction: dto.externalRef, amount: dto.amount ? Math.round(dto.amount * AMOUNT_SUBUNIT_MULTIPLIER) : undefined },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return {
      txRef:        dto.externalRef,
      externalRef:  dto.externalRef,
      status:       'REVERSED',
      amount:       dto.amount ?? 0,
      currency:     'NGN',
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  private async getSecretKey(): Promise<string> {
    const now = Date.now();
    if (this.secretKey && now - this.keyCachedAt < SECRET_CACHE_TTL_MS) return this.secretKey;
    const s = await this.secretService.getSecretObject<{ SECRET_KEY: string }>(VAULT_PATH);
    if (!s.SECRET_KEY) throw new Error(`Paystack SECRET_KEY missing in Vault (${VAULT_PATH})`);
    this.secretKey = s.SECRET_KEY;
    this.keyCachedAt = now;
    return this.secretKey;
  }

  /** Conservé pour compat interface — non utilisé (on retourne toujours 'paystack_agg'). */
  private _mapStatus(raw: string): PaymentStatus {
    return raw === 'success' ? 'SUCCESSFUL' : 'FAILED';
  }
}
