import {
  Injectable,
  Logger,
  Inject,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import axios, { AxiosInstance } from 'axios';
import {
  IPaymentService,
  InitiatePaymentDto,
  PaymentResult,
  PaymentStatus,
  WebhookVerificationResult,
  RefundDto,
} from './interfaces/payment.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

/**
 * FlutterwaveService — implémentation de IPaymentService via Flutterwave v3.
 *
 * Sécurité :
 *   - Clé secrète lue depuis Vault KV : "platform/flutterwave" → { SECRET_KEY, WEBHOOK_HASH }
 *   - La clé n'est JAMAIS dans process.env — Vault uniquement (PRD §II.2)
 *   - Vérification webhook HMAC-SHA256 en temps constant (timingSafeEqual)
 *   - txRef idempotent : même ref = même paiement (Flutterwave déduplique)
 *   - rawBody obligatoire pour la vérification webhook — ne jamais parser avant
 *
 * API reference : https://developer.flutterwave.com/reference
 */
@Injectable()
export class FlutterwaveService implements IPaymentService {
  private readonly logger  = new Logger(FlutterwaveService.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';

  private http: AxiosInstance;
  private secretKey:   string | null = null;
  private webhookHash: string | null = null;
  private readonly KEY_TTL_MS = 5 * 60 * 1_000; // 5min cache
  private keyCachedAt = 0;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 15_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();

    const payload: Record<string, unknown> = {
      tx_ref:          dto.txRef,
      amount:          dto.amount,
      currency:        dto.currency,
      redirect_url:    dto.redirectUrl ?? 'https://app.translogpro.com/payment/confirm',
      customer: {
        email:       dto.customerEmail ?? `${dto.txRef}@translogpro.noreply`,
        phonenumber: dto.customerPhone,
        name:        dto.customerName ?? 'Client TransLog',
      },
      meta:            dto.meta ?? {},
      payment_options: this.mapMethod(dto.method),
    };

    const { data } = await this.http.post('/payments', payload, {
      headers: { Authorization: `Bearer ${key}` },
    });

    this.logger.log(`[FLW] Payment initiated tx_ref=${dto.txRef} status=${data.status}`);

    return {
      txRef:        dto.txRef,
      externalRef:  data.data?.id?.toString() ?? dto.txRef,
      status:       this.mapStatus(data.status),
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: 'flutterwave',
      paymentUrl:   data.data?.link ?? undefined,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const key = await this.getSecretKey();

    const { data } = await this.http.get(`/transactions/${externalRef}/verify`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    const tx = data.data;
    return {
      txRef:        tx.tx_ref,
      externalRef:  externalRef,
      status:       this.mapStatus(tx.status),
      amount:       tx.charged_amount,
      currency:     tx.currency,
      providerName: 'flutterwave',
      processedAt:  tx.created_at ? new Date(tx.created_at) : undefined,
    };
  }

  async verifyWebhook(
    rawBody:   Buffer,
    signature: string,
  ): Promise<WebhookVerificationResult> {
    const { webhookHash } = await this.getKeys();

    // HMAC-SHA256 en temps constant — résiste aux timing attacks
    const computed = createHmac('sha256', webhookHash)
      .update(rawBody)
      .digest('hex');

    const sigBuf  = Buffer.from(signature, 'hex');
    const compBuf = Buffer.from(computed,  'hex');

    const valid = sigBuf.length === compBuf.length && timingSafeEqual(sigBuf, compBuf);
    if (!valid) {
      this.logger.warn('[FLW] Webhook signature mismatch — rejected');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const data  = body['data'] as Record<string, unknown>;

    return {
      isValid:     true,
      txRef:       String(data['tx_ref']         ?? ''),
      externalRef: String(data['id']             ?? ''),
      status:      this.mapStatus(String(data['status'] ?? '')),
      amount:      Number(data['charged_amount'] ?? 0),
      currency:    String(data['currency']       ?? 'XOF') as PaymentResult['currency'],
      meta:        (data['meta'] ?? {}) as Record<string, unknown>,
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();

    const payload: Record<string, unknown> = { comments: dto.reason };
    if (dto.amount !== undefined) payload['amount'] = dto.amount;

    const { data } = await this.http.post(
      `/transactions/${dto.externalRef}/refund`,
      payload,
      { headers: { Authorization: `Bearer ${key}` } },
    );

    const tx = data.data;
    return {
      txRef:        tx.tx_ref ?? dto.externalRef,
      externalRef:  dto.externalRef,
      status:       this.mapStatus(tx.status),
      amount:       tx.amount_refunded ?? (dto.amount ?? 0),
      currency:     tx.currency ?? 'XOF',
      providerName: 'flutterwave',
      processedAt:  new Date(),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async getSecretKey(): Promise<string> {
    const { secretKey } = await this.getKeys();
    return secretKey;
  }

  private async getKeys(): Promise<{ secretKey: string; webhookHash: string }> {
    const now = Date.now();
    if (this.secretKey && this.webhookHash && now - this.keyCachedAt < this.KEY_TTL_MS) {
      return { secretKey: this.secretKey, webhookHash: this.webhookHash };
    }

    const secrets = await this.secretService.getSecretObject<{
      SECRET_KEY: string;
      WEBHOOK_HASH: string;
    }>('platform/flutterwave');

    if (!secrets.SECRET_KEY || !secrets.WEBHOOK_HASH) {
      throw new Error('Flutterwave secrets missing in Vault (platform/flutterwave)');
    }

    this.secretKey   = secrets.SECRET_KEY;
    this.webhookHash = secrets.WEBHOOK_HASH;
    this.keyCachedAt = now;

    return { secretKey: this.secretKey, webhookHash: this.webhookHash };
  }

  private mapStatus(raw: string): PaymentStatus {
    switch (raw.toLowerCase()) {
      case 'successful':
      case 'success':
      case 'complete':
        return 'SUCCESSFUL';
      case 'failed':
      case 'error':
        return 'FAILED';
      case 'cancelled':
      case 'canceled':
        return 'CANCELLED';
      case 'reversed':
        return 'REVERSED';
      default:
        return 'PENDING';
    }
  }

  private mapMethod(method: InitiatePaymentDto['method']): string {
    switch (method) {
      case 'MOBILE_MONEY':  return 'mobilemoneyssenegal,mobilemoneyghana,mobilemoneyuganda';
      case 'CARD':          return 'card';
      case 'BANK_TRANSFER': return 'banktransfer';
      case 'USSD':          return 'ussd';
      default:              return 'mobilemoneyssenegal';
    }
  }
}

/**
 * PaystackService — stub pour activation future (Nigeria/Ghana focus).
 * Même interface IPaymentService — permutable sans modifier le code métier.
 */
@Injectable()
export class PaystackService implements IPaymentService {
  private readonly logger  = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private http: AxiosInstance;
  private secretKey:   string | null = null;
  private readonly KEY_TTL_MS = 5 * 60 * 1_000;
  private keyCachedAt = 0;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({ baseURL: this.baseUrl, timeout: 15_000 });
  }

  async initiate(dto: InitiatePaymentDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();

    const amountKobo = Math.round(dto.amount * 100); // Paystack en kobo
    const { data } = await this.http.post(
      '/transaction/initialize',
      {
        reference:     dto.txRef,
        amount:        amountKobo,
        currency:      dto.currency,
        email:         dto.customerEmail ?? `${dto.txRef}@translogpro.noreply`,
        callback_url:  dto.redirectUrl,
        metadata:      { ...dto.meta, custom_fields: [] },
      },
      { headers: { Authorization: `Bearer ${key}` } },
    );

    return {
      txRef:        dto.txRef,
      externalRef:  data.data?.reference ?? dto.txRef,
      status:       'PENDING',
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: 'paystack',
      paymentUrl:   data.data?.authorization_url,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const key = await this.getSecretKey();

    const { data } = await this.http.get(`/transaction/verify/${externalRef}`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    const tx = data.data;
    return {
      txRef:        tx.reference,
      externalRef,
      status:       tx.status === 'success' ? 'SUCCESSFUL' : 'FAILED',
      amount:       tx.amount / 100,
      currency:     tx.currency,
      providerName: 'paystack',
      processedAt:  tx.paid_at ? new Date(tx.paid_at) : undefined,
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const key = await this.getSecretKey();

    const computed = createHmac('sha512', key).update(rawBody).digest('hex');
    const sigBuf   = Buffer.from(signature, 'hex');
    const compBuf  = Buffer.from(computed,  'hex');

    if (sigBuf.length !== compBuf.length || !timingSafeEqual(sigBuf, compBuf)) {
      throw new UnauthorizedException('Invalid Paystack webhook signature');
    }

    const body  = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const tx    = body['data'] as Record<string, unknown>;

    return {
      isValid:     true,
      txRef:       String(tx['reference'] ?? ''),
      externalRef: String(tx['id']        ?? ''),
      status:      (tx['status'] === 'success') ? 'SUCCESSFUL' : 'FAILED',
      amount:      Number(tx['amount'] ?? 0) / 100,
      currency:    String(tx['currency'] ?? 'NGN') as PaymentResult['currency'],
    };
  }

  async refund(dto: RefundDto): Promise<PaymentResult> {
    const key = await this.getSecretKey();
    await this.http.post(
      '/refund',
      { transaction: dto.externalRef, amount: dto.amount ? Math.round(dto.amount * 100) : undefined },
      { headers: { Authorization: `Bearer ${key}` } },
    );
    return {
      txRef: dto.externalRef, externalRef: dto.externalRef,
      status: 'REVERSED', amount: dto.amount ?? 0, currency: 'NGN',
      providerName: 'paystack', processedAt: new Date(),
    };
  }

  private async getSecretKey(): Promise<string> {
    const now = Date.now();
    if (this.secretKey && now - this.keyCachedAt < this.KEY_TTL_MS) return this.secretKey;
    const s = await this.secretService.getSecretObject<{ SECRET_KEY: string }>('platform/paystack');
    if (!s.SECRET_KEY) throw new Error('Paystack SECRET_KEY missing in Vault');
    this.secretKey   = s.SECRET_KEY;
    this.keyCachedAt = now;
    return this.secretKey;
  }
}
