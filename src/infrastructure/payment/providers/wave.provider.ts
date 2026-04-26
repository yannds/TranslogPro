/**
 * WaveProvider — Wave Business API (Sénégal, Côte d'Ivoire, Mali, Burkina).
 *
 * Doc : https://docs.wave.com/business
 * Endpoint Checkout (in) :
 *   POST /v1/checkout/sessions  → session paiement
 *   GET  /v1/checkout/sessions/{id}
 *   POST /v1/checkout/sessions/{id}/refund
 *
 * Vault path : platform/payments/wave
 * Secrets requis :
 *   - API_KEY          (Bearer)
 *   - WEBHOOK_SECRET   (HMAC-SHA256 du rawBody)
 *   - BASE_URL (opt.)
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

const VAULT_PATH           = 'platform/payments/wave';
const HTTP_TIMEOUT_MS      = 15_000;
const SECRET_CACHE_TTL_MS  = 5 * 60 * 1_000;
const DEFAULT_BASE_URL     = 'https://api.wave.com';

interface WaveSecrets {
  API_KEY:        string;
  WEBHOOK_SECRET: string;
  BASE_URL?:      string;
}

@Injectable()
export class WaveProvider implements IPaymentProvider {
  private readonly log = new Logger(WaveProvider.name);
  private http!: AxiosInstance;
  private baseUrl = DEFAULT_BASE_URL;
  private secrets: WaveSecrets | null = null;
  private secretsCachedAt = 0;

  readonly meta: PaymentProviderMeta = {
    key:                 'wave',
    displayName:         'Wave',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['SN', 'CI', 'ML', 'BF'],
    supportedCurrencies: ['XOF'],
    defaultVaultPath:    VAULT_PATH,
    credentialFields: [
      { key: 'API_KEY',        label: 'API Key',        type: 'password', required: true, helpText: 'Bearer token depuis https://business.wave.com → Settings → API' },
      { key: 'WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', required: true, helpText: 'Secret HMAC-SHA256 de vérification des webhooks Wave' },
      { key: 'BASE_URL', label: 'Base URL (optionnel)', type: 'text', required: false, placeholder: 'https://api.wave.com' },
    ],
  };

  readonly webhookSignatureHeader = 'wave-signature';

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({ timeout: HTTP_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } });
  }

  get isEnabled(): boolean { return true; }

  supports(q: SupportsQuery): boolean {
    return this.meta.supportedMethods.includes(q.method)
        && this.meta.supportedCountries.includes(q.country)
        && this.meta.supportedCurrencies.includes(q.currency);
  }

  /** Wave Direct API : pas de split natif. Aggregated Merchants ≠ split-charge. */
  supportsSplit(): boolean { return false; }

  async healthcheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const s = await this.getSecrets();
      await this.http.get(`${this.baseUrl}/v1/payout-batches`, {
        headers: { Authorization: `Bearer ${s.API_KEY}` },
      });
      return { status: 'UP', checkedAt: new Date(), latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'DOWN', checkedAt: new Date(), latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err) };
    }
  }

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const s = await this.getSecrets();
    const { data } = await this.http.post(
      `${this.baseUrl}/v1/checkout/sessions`,
      {
        amount:              String(dto.amount),
        currency:            dto.currency,
        error_url:           dto.redirectUrl ? `${dto.redirectUrl}?status=error` : undefined,
        success_url:         dto.redirectUrl ? `${dto.redirectUrl}?status=success` : undefined,
        client_reference:    dto.txRef,
        // `restrict_payer_mobile` optionnel
      },
      { headers: { Authorization: `Bearer ${s.API_KEY}` } },
    );
    this.log.log(`[WAVE] session created id=${data.id} tx=${dto.txRef}`);
    return {
      txRef:        dto.txRef,
      externalRef:  String(data.id),
      status:       'PENDING',
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: this.meta.key,
      paymentUrl:   data.wave_launch_url,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const s = await this.getSecrets();
    const { data } = await this.http.get(
      `${this.baseUrl}/v1/checkout/sessions/${externalRef}`,
      { headers: { Authorization: `Bearer ${s.API_KEY}` } },
    );
    return {
      txRef:        String(data.client_reference ?? externalRef),
      externalRef,
      status:       this.mapStatus(String(data.payment_status ?? data.status ?? '')),
      amount:       Number(data.amount ?? 0),
      currency:     String(data.currency ?? 'XOF') as PaymentResult['currency'],
      providerName: this.meta.key,
      processedAt:  data.when_completed ? new Date(data.when_completed) : undefined,
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const s = await this.getSecrets();
    // Wave signe sous la forme `t=<timestamp>,v1=<signature>`
    const parts = signature.split(',').reduce<Record<string, string>>((acc, kv) => {
      const [k, v] = kv.split('='); if (k && v) acc[k.trim()] = v.trim(); return acc;
    }, {});
    const sigHex = parts['v1'];
    const ts     = parts['t'];
    if (!sigHex || !ts) throw new UnauthorizedException('Malformed Wave signature');
    const payload = `${ts}.${rawBody.toString('utf8')}`;
    const computed = createHmac('sha256', s.WEBHOOK_SECRET).update(payload).digest('hex');
    const a = Buffer.from(sigHex,  'hex');
    const b = Buffer.from(computed, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid Wave webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const data = (body['data'] ?? body) as Record<string, unknown>;
    return {
      isValid:     true,
      txRef:       String(data['client_reference'] ?? ''),
      externalRef: String(data['id'] ?? ''),
      status:      this.mapStatus(String(data['payment_status'] ?? data['status'] ?? '')),
      amount:      Number(data['amount'] ?? 0),
      currency:    String(data['currency'] ?? 'XOF') as WebhookVerificationResult['currency'],
      meta:        body,
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const s = await this.getSecrets();
    const { data } = await this.http.post(
      `${this.baseUrl}/v1/checkout/sessions/${dto.externalRef}/refund`,
      {},
      { headers: { Authorization: `Bearer ${s.API_KEY}` } },
    );
    return {
      txRef:        dto.externalRef,
      externalRef:  String(data?.id ?? dto.externalRef),
      status:       'REVERSED',
      amount:       dto.amount ?? Number(data?.amount ?? 0),
      currency:     'XOF',
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  private async getSecrets(): Promise<WaveSecrets> {
    const now = Date.now();
    if (this.secrets && now - this.secretsCachedAt < SECRET_CACHE_TTL_MS) return this.secrets;
    const s = await this.secretService.getSecretObject<WaveSecrets>(VAULT_PATH);
    if (!s.API_KEY || !s.WEBHOOK_SECRET) throw new Error(`Wave: secrets manquants (${VAULT_PATH})`);
    this.baseUrl = s.BASE_URL || DEFAULT_BASE_URL;
    this.secrets = s;
    this.secretsCachedAt = now;
    return s;
  }

  private mapStatus(raw: string): PaymentStatus {
    switch (raw.toLowerCase()) {
      case 'succeeded':
      case 'successful':
      case 'paid':        return 'SUCCESSFUL';
      case 'failed':
      case 'expired':     return 'FAILED';
      case 'cancelled':
      case 'canceled':    return 'CANCELLED';
      case 'refunded':    return 'REVERSED';
      default:            return 'PENDING';
    }
  }
}
