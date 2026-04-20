/**
 * MtnMomoCgProvider — MTN Mobile Money Congo (Brazzaville).
 *
 * 3 produits MTN utilisés :
 *   - Collection v1_0  : encaisser un client (push MoMo)           → initiate/verify
 *   - Disbursement v1_0 : verser vers un client (refund fallback)  → refund
 *
 * Sandbox    : https://sandbox.momodeveloper.mtn.com
 * Production : https://momodeveloper.mtn.com  (target env = "mtncongo")
 *
 * Vault path   : platform/payments/mtn_momo_cg
 * Secrets requis :
 *   - COLLECTION_SUBSCRIPTION_KEY
 *   - COLLECTION_API_USER
 *   - COLLECTION_API_KEY
 *   - DISBURSEMENT_SUBSCRIPTION_KEY
 *   - DISBURSEMENT_API_USER
 *   - DISBURSEMENT_API_KEY
 *   - TARGET_ENVIRONMENT      ("sandbox" ou "mtncongo")
 *   - WEBHOOK_HMAC_KEY        (clé de signature des callbacks)
 *   - BASE_URL                (surchargeable par env)
 *
 * Sécurité :
 *   - Bearer token OAuth récupéré par pair (api_user, api_key), cache 50 min.
 *   - Webhook HMAC-SHA256 sur le rawBody (clé = WEBHOOK_HMAC_KEY).
 *   - Aucun secret en env var — Vault uniquement.
 */
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import {
  InitiatePaymentDto,
  PaymentResult,
  PaymentStatus,
  RefundDto,
  WebhookVerificationResult,
} from '../interfaces/payment.interface';
import { ISecretService, SECRET_SERVICE } from '../../secret/interfaces/secret.interface';
import { IPaymentProvider, PaymentProviderMeta, ProviderHealth, SupportsQuery } from './types';

const VAULT_PATH         = 'platform/payments/mtn_momo_cg';
const HTTP_TIMEOUT_MS    = 20_000;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1_000;
const TOKEN_CACHE_TTL_MS  = 50 * 60 * 1_000;  // tokens OAuth MTN ~60 min, marge 10 min
const DEFAULT_BASE_URL   = 'https://sandbox.momodeveloper.mtn.com';

interface MtnSecrets {
  COLLECTION_SUBSCRIPTION_KEY:   string;
  COLLECTION_API_USER:           string;
  COLLECTION_API_KEY:            string;
  DISBURSEMENT_SUBSCRIPTION_KEY: string;
  DISBURSEMENT_API_USER:         string;
  DISBURSEMENT_API_KEY:          string;
  TARGET_ENVIRONMENT:            string;   // "sandbox" | "mtncongo"
  WEBHOOK_HMAC_KEY:              string;
  BASE_URL?:                     string;
}

@Injectable()
export class MtnMomoCgProvider implements IPaymentProvider {
  private readonly log = new Logger(MtnMomoCgProvider.name);
  private http!: AxiosInstance;
  private baseUrl: string = DEFAULT_BASE_URL;
  private secrets: MtnSecrets | null = null;
  private secretsCachedAt = 0;
  private collectionToken:   { token: string; expiresAt: number } | null = null;
  private disbursementToken: { token: string; expiresAt: number } | null = null;

  readonly meta: PaymentProviderMeta = {
    key:                 'mtn_momo_cg',
    displayName:         'MTN MoMo Congo',
    supportedMethods:    ['MOBILE_MONEY'],
    supportedCountries:  ['CG'],
    supportedCurrencies: ['XAF'],
    defaultVaultPath:    VAULT_PATH,
    credentialFields: [
      { key: 'COLLECTION_SUBSCRIPTION_KEY', label: 'Collection Subscription Key', type: 'password', required: true, helpText: 'Ocp-Apim-Subscription-Key du produit Collection (https://momodeveloper.mtn.com)' },
      { key: 'COLLECTION_API_USER',         label: 'Collection API User (UUID)',  type: 'text',     required: true },
      { key: 'COLLECTION_API_KEY',          label: 'Collection API Key',          type: 'password', required: true },
      { key: 'DISBURSEMENT_SUBSCRIPTION_KEY', label: 'Disbursement Subscription Key', type: 'password', required: true, helpText: 'Ocp-Apim-Subscription-Key du produit Disbursement' },
      { key: 'DISBURSEMENT_API_USER',       label: 'Disbursement API User (UUID)', type: 'text',    required: true },
      { key: 'DISBURSEMENT_API_KEY',        label: 'Disbursement API Key',         type: 'password', required: true },
      { key: 'TARGET_ENVIRONMENT', label: 'Environnement cible', type: 'select', required: true, options: ['sandbox', 'mtncongo'], helpText: '"sandbox" pour les tests, "mtncongo" pour la production Congo' },
      { key: 'WEBHOOK_HMAC_KEY', label: 'Webhook HMAC Key', type: 'password', required: true, helpText: 'Clé secrète de vérification des callbacks MTN' },
      { key: 'BASE_URL', label: 'Base URL (optionnel)', type: 'text', required: false, placeholder: 'https://sandbox.momodeveloper.mtn.com' },
    ],
  };

  readonly webhookSignatureHeader = 'x-mtn-signature';

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
      await this.getCollectionToken();
      return { status: 'UP', checkedAt: new Date(), latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'DOWN', checkedAt: new Date(), latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ─── Collection : initiate / verify ────────────────────────────────────────

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getCollectionToken();
    const refId   = randomUUID();  // X-Reference-Id MTN — idempotent

    const phone = this.stripPlus(dto.customerPhone ?? '');
    if (!phone) throw new Error('MTN MoMo requires customerPhone (MSISDN)');

    await this.http.post(
      `${this.baseUrl}/collection/v1_0/requesttopay`,
      {
        amount:     String(dto.amount),
        currency:   dto.currency,
        externalId: dto.txRef,
        payer:      { partyIdType: 'MSISDN', partyId: phone },
        payerMessage: (dto.meta?.description ?? 'TransLog payment').toString().slice(0, 50),
        payeeNote:  (dto.meta?.note        ?? 'TransLog').toString().slice(0, 50),
      },
      {
        headers: {
          'Authorization':          `Bearer ${token}`,
          'X-Reference-Id':         refId,
          'X-Target-Environment':   secrets.TARGET_ENVIRONMENT,
          'Ocp-Apim-Subscription-Key': secrets.COLLECTION_SUBSCRIPTION_KEY,
        },
      },
    );

    this.log.log(`[MTN] requesttopay refId=${refId} tx=${dto.txRef}`);
    return {
      txRef:        dto.txRef,
      externalRef:  refId,
      status:       'PENDING',
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: this.meta.key,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getCollectionToken();
    const { data } = await this.http.get(
      `${this.baseUrl}/collection/v1_0/requesttopay/${externalRef}`,
      {
        headers: {
          'Authorization':             `Bearer ${token}`,
          'X-Target-Environment':      secrets.TARGET_ENVIRONMENT,
          'Ocp-Apim-Subscription-Key': secrets.COLLECTION_SUBSCRIPTION_KEY,
        },
      },
    );
    return {
      txRef:        data.externalId,
      externalRef,
      status:       this.mapStatus(data.status),
      amount:       Number(data.amount ?? 0),
      currency:     data.currency,
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const secrets = await this.getSecrets();
    const computed = createHmac('sha256', secrets.WEBHOOK_HMAC_KEY).update(rawBody).digest('hex');
    const sig  = Buffer.from(signature, 'hex');
    const comp = Buffer.from(computed,  'hex');
    if (sig.length !== comp.length || !timingSafeEqual(sig, comp)) {
      throw new UnauthorizedException('Invalid MTN webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    return {
      isValid:     true,
      txRef:       String(body['externalId'] ?? ''),
      externalRef: String(body['referenceId'] ?? body['financialTransactionId'] ?? ''),
      status:      this.mapStatus(String(body['status'] ?? '')),
      amount:      Number(body['amount'] ?? 0),
      currency:    String(body['currency'] ?? 'XAF') as WebhookVerificationResult['currency'],
      meta:        body,
    };
  }

  // ─── Refund via Disbursement (push sortant vers client) ────────────────────

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const secrets = await this.getSecrets();
    const token   = await this.getDisbursementToken();
    const refId   = randomUUID();

    // externalRef ici = referenceId du paiement original ; on le met en metadata pour audit.
    await this.http.post(
      `${this.baseUrl}/disbursement/v1_0/transfer`,
      {
        amount:        String(dto.amount ?? 0),
        currency:      'XAF',
        externalId:    dto.externalRef,
        payee:         { partyIdType: 'MSISDN', partyId: dto.externalRef /* the caller must pass phone OR we lookup */ },
        payerMessage:  `Refund: ${dto.reason}`.slice(0, 50),
        payeeNote:     `Refund orig=${dto.externalRef}`.slice(0, 50),
      },
      {
        headers: {
          'Authorization':             `Bearer ${token}`,
          'X-Reference-Id':            refId,
          'X-Target-Environment':      secrets.TARGET_ENVIRONMENT,
          'Ocp-Apim-Subscription-Key': secrets.DISBURSEMENT_SUBSCRIPTION_KEY,
        },
      },
    );
    return {
      txRef:        dto.externalRef,
      externalRef:  refId,
      status:       'PENDING',          // disbursement est async — webhook confirme
      amount:       dto.amount ?? 0,
      currency:     'XAF',
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  // ─── privé ─────────────────────────────────────────────────────────────────

  private async getSecrets(): Promise<MtnSecrets> {
    const now = Date.now();
    if (this.secrets && now - this.secretsCachedAt < SECRET_CACHE_TTL_MS) return this.secrets;
    const s = await this.secretService.getSecretObject<MtnSecrets>(VAULT_PATH);
    this.validateSecrets(s);
    this.baseUrl = s.BASE_URL || DEFAULT_BASE_URL;
    this.secrets = s;
    this.secretsCachedAt = now;
    // Invalide le cache tokens après rotation de secrets
    this.collectionToken = null;
    this.disbursementToken = null;
    return s;
  }

  private validateSecrets(s: Partial<MtnSecrets>): void {
    const required: (keyof MtnSecrets)[] = [
      'COLLECTION_SUBSCRIPTION_KEY', 'COLLECTION_API_USER', 'COLLECTION_API_KEY',
      'DISBURSEMENT_SUBSCRIPTION_KEY', 'DISBURSEMENT_API_USER', 'DISBURSEMENT_API_KEY',
      'TARGET_ENVIRONMENT', 'WEBHOOK_HMAC_KEY',
    ];
    for (const k of required) {
      if (!s[k]) throw new Error(`MTN MoMo: secret manquant ${VAULT_PATH}/${String(k)}`);
    }
  }

  private async getCollectionToken(): Promise<string> {
    const now = Date.now();
    if (this.collectionToken && this.collectionToken.expiresAt > now) return this.collectionToken.token;
    const s = await this.getSecrets();
    const token = await this.fetchToken('collection', s.COLLECTION_API_USER, s.COLLECTION_API_KEY, s.COLLECTION_SUBSCRIPTION_KEY);
    this.collectionToken = { token, expiresAt: now + TOKEN_CACHE_TTL_MS };
    return token;
  }

  private async getDisbursementToken(): Promise<string> {
    const now = Date.now();
    if (this.disbursementToken && this.disbursementToken.expiresAt > now) return this.disbursementToken.token;
    const s = await this.getSecrets();
    const token = await this.fetchToken('disbursement', s.DISBURSEMENT_API_USER, s.DISBURSEMENT_API_KEY, s.DISBURSEMENT_SUBSCRIPTION_KEY);
    this.disbursementToken = { token, expiresAt: now + TOKEN_CACHE_TTL_MS };
    return token;
  }

  private async fetchToken(
    product: 'collection' | 'disbursement',
    apiUser: string, apiKey: string, subKey: string,
  ): Promise<string> {
    const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
    const { data } = await this.http.post(
      `${this.baseUrl}/${product}/token/`,
      {},
      {
        headers: {
          'Authorization':             `Basic ${basic}`,
          'Ocp-Apim-Subscription-Key': subKey,
        },
      },
    );
    if (!data?.access_token) throw new Error(`MTN ${product} token: réponse invalide`);
    return data.access_token as string;
  }

  private stripPlus(phone: string): string {
    return phone.replace(/^\+/, '').replace(/\D/g, '');
  }

  private mapStatus(raw: string): PaymentStatus {
    switch (raw.toUpperCase()) {
      case 'SUCCESSFUL': return 'SUCCESSFUL';
      case 'FAILED':     return 'FAILED';
      case 'REJECTED':   return 'CANCELLED';
      case 'PENDING':    return 'PENDING';
      default:           return 'PENDING';
    }
  }
}
