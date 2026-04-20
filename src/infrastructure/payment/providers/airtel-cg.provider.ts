/**
 * AirtelMoneyCgProvider — Airtel Money Congo (Brazzaville).
 *
 * API : Airtel Africa OpenAPI
 *   Sandbox    : https://openapiuat.airtel.africa
 *   Production : https://openapi.airtel.africa
 *
 * Endpoints :
 *   - POST /auth/oauth2/token                                  → OAuth client_credentials
 *   - POST /merchant/v1/payments/                              → initiate (USSD push)
 *   - GET  /standard/v1/payments/{transaction_id}              → verify
 *   - POST /standard/v1/disbursements/                         → refund (push sortant)
 *
 * Pas d'endpoint refund natif dans Collection → on route via Disbursements.
 *
 * Vault path : platform/payments/airtel_cg
 * Secrets requis :
 *   - CLIENT_ID
 *   - CLIENT_SECRET
 *   - X_COUNTRY             ("CG")
 *   - X_CURRENCY            ("XAF")
 *   - WEBHOOK_HMAC_KEY
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

const VAULT_PATH          = 'platform/payments/airtel_cg';
const HTTP_TIMEOUT_MS     = 20_000;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1_000;
const TOKEN_CACHE_TTL_MS  = 55 * 60 * 1_000;   // tokens Airtel 60 min, marge 5
const DEFAULT_BASE_URL    = 'https://openapiuat.airtel.africa';

interface AirtelSecrets {
  CLIENT_ID:        string;
  CLIENT_SECRET:    string;
  X_COUNTRY:        string;
  X_CURRENCY:       string;
  WEBHOOK_HMAC_KEY: string;
  BASE_URL?:        string;
}

@Injectable()
export class AirtelMoneyCgProvider implements IPaymentProvider {
  private readonly log = new Logger(AirtelMoneyCgProvider.name);
  private http!: AxiosInstance;
  private baseUrl = DEFAULT_BASE_URL;
  private secrets: AirtelSecrets | null = null;
  private secretsCachedAt = 0;
  private token: { value: string; expiresAt: number } | null = null;

  readonly meta: PaymentProviderMeta = {
    key:                 'airtel_cg',
    displayName:         'Airtel Money Congo',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['CG'],
    supportedCurrencies: ['XAF'],
    defaultVaultPath:    VAULT_PATH,
    credentialFields: [
      { key: 'CLIENT_ID',        label: 'Client ID',        type: 'text',     required: true, helpText: 'App Client ID depuis https://developers.airtel.africa' },
      { key: 'CLIENT_SECRET',    label: 'Client Secret',    type: 'password', required: true },
      { key: 'X_COUNTRY',        label: 'Pays (X-Country)', type: 'text',     required: true, placeholder: 'CG', helpText: 'Code pays ISO 3166-1 alpha-2 (ex: CG, CD, TZ)' },
      { key: 'X_CURRENCY',       label: 'Devise (X-Currency)', type: 'text',  required: true, placeholder: 'XAF' },
      { key: 'WEBHOOK_HMAC_KEY', label: 'Webhook HMAC Key', type: 'password', required: true },
      { key: 'BASE_URL', label: 'Base URL (optionnel)', type: 'text', required: false, placeholder: 'https://openapiuat.airtel.africa' },
    ],
  };

  readonly webhookSignatureHeader = 'x-airtel-signature';

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

  async healthcheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      await this.getToken();
      return { status: 'UP', checkedAt: new Date(), latencyMs: Date.now() - start };
    } catch (err) {
      return { status: 'DOWN', checkedAt: new Date(), latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err) };
    }
  }

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getToken();
    const phone   = this.stripPlus(dto.customerPhone ?? '');
    if (!phone) throw new Error('Airtel Money requires customerPhone (MSISDN)');

    const { data } = await this.http.post(
      `${this.baseUrl}/merchant/v1/payments/`,
      {
        reference:    dto.txRef,
        subscriber:   { country: secrets.X_COUNTRY, currency: secrets.X_CURRENCY, msisdn: phone },
        transaction:  { amount: dto.amount, country: secrets.X_COUNTRY, currency: secrets.X_CURRENCY, id: dto.txRef },
      },
      {
        headers: this.authHeaders(token, secrets),
      },
    );
    const externalRef = String(data?.data?.transaction?.id ?? dto.txRef);
    this.log.log(`[AIRTEL] payment tx=${dto.txRef} ext=${externalRef}`);
    return {
      txRef:        dto.txRef,
      externalRef,
      status:       this.mapStatus(String(data?.data?.transaction?.status ?? 'PENDING')),
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: this.meta.key,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getToken();
    const { data } = await this.http.get(
      `${this.baseUrl}/standard/v1/payments/${externalRef}`,
      { headers: this.authHeaders(token, secrets) },
    );
    const tx = data?.data?.transaction ?? {};
    return {
      txRef:        String(tx.id ?? externalRef),
      externalRef,
      status:       this.mapStatus(String(tx.status ?? 'PENDING')),
      amount:       Number(tx.amount ?? 0),
      currency:     String(tx.currency ?? 'XAF') as PaymentResult['currency'],
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const secrets = await this.getSecrets();
    const computed = createHmac('sha256', secrets.WEBHOOK_HMAC_KEY).update(rawBody).digest('hex');
    const sig  = Buffer.from(signature, 'hex');
    const comp = Buffer.from(computed,  'hex');
    if (sig.length !== comp.length || !timingSafeEqual(sig, comp)) {
      throw new UnauthorizedException('Invalid Airtel webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const tx = (body['transaction'] ?? body['data'] ?? {}) as Record<string, unknown>;
    return {
      isValid:     true,
      txRef:       String(tx['id'] ?? ''),
      externalRef: String(tx['airtel_money_id'] ?? tx['id'] ?? ''),
      status:      this.mapStatus(String(tx['status_code'] ?? tx['status'] ?? '')),
      amount:      Number(tx['amount'] ?? 0),
      currency:    String(tx['currency'] ?? 'XAF') as WebhookVerificationResult['currency'],
      meta:        body,
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getToken();
    // Disbursement : pousse l'argent vers le client. Le MSISDN doit être passé via meta
    // par l'orchestrator (qui connaît le customerPhone via le PaymentIntent).
    // Ici on fait confiance à `dto.reason` + externalRef comme idempotency.
    const { data } = await this.http.post(
      `${this.baseUrl}/standard/v1/disbursements/`,
      {
        payee:       { msisdn: dto.externalRef /* à remplacer en P12 — voir README */ },
        reference:   `refund-${dto.externalRef}`,
        pin:         '',
        transaction: { amount: dto.amount ?? 0, id: `refund-${dto.externalRef}` },
      },
      { headers: this.authHeaders(token, secrets) },
    );
    return {
      txRef:        dto.externalRef,
      externalRef:  String(data?.data?.transaction?.id ?? dto.externalRef),
      status:       this.mapStatus(String(data?.data?.transaction?.status ?? 'PENDING')),
      amount:       dto.amount ?? 0,
      currency:     'XAF',
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  // ─── privé ─────────────────────────────────────────────────────────────────

  private authHeaders(token: string, secrets: AirtelSecrets): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'X-Country':   secrets.X_COUNTRY,
      'X-Currency':  secrets.X_CURRENCY,
    };
  }

  private async getSecrets(): Promise<AirtelSecrets> {
    const now = Date.now();
    if (this.secrets && now - this.secretsCachedAt < SECRET_CACHE_TTL_MS) return this.secrets;
    const s = await this.secretService.getSecretObject<AirtelSecrets>(VAULT_PATH);
    const required: (keyof AirtelSecrets)[] = ['CLIENT_ID', 'CLIENT_SECRET', 'X_COUNTRY', 'X_CURRENCY', 'WEBHOOK_HMAC_KEY'];
    for (const k of required) {
      if (!s[k]) throw new Error(`Airtel: secret manquant ${VAULT_PATH}/${String(k)}`);
    }
    this.baseUrl = s.BASE_URL || DEFAULT_BASE_URL;
    this.secrets = s;
    this.secretsCachedAt = now;
    this.token = null;
    return s;
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;
    const s = await this.getSecrets();
    const { data } = await this.http.post(`${this.baseUrl}/auth/oauth2/token`, {
      client_id:     s.CLIENT_ID,
      client_secret: s.CLIENT_SECRET,
      grant_type:    'client_credentials',
    });
    if (!data?.access_token) throw new Error('Airtel token: réponse invalide');
    this.token = { value: data.access_token as string, expiresAt: now + TOKEN_CACHE_TTL_MS };
    return this.token.value;
  }

  private stripPlus(phone: string): string { return phone.replace(/^\+/, '').replace(/\D/g, ''); }

  private mapStatus(raw: string): PaymentStatus {
    const s = raw.toUpperCase();
    if (['TS', 'TXN_SUCCESS', 'SUCCESS', 'SUCCESSFUL', '200'].includes(s)) return 'SUCCESSFUL';
    if (['TF', 'TXN_FAILED', 'FAILED', 'ERROR'].includes(s))               return 'FAILED';
    if (['TC', 'CANCELLED', 'CANCELED'].includes(s))                       return 'CANCELLED';
    if (['TA', 'REVERSED', 'REFUNDED'].includes(s))                        return 'REVERSED';
    return 'PENDING';
  }
}
