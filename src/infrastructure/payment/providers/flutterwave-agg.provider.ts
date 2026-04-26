/**
 * FlutterwaveAggregatorProvider — agrégateur multi-méthodes Afrique sub-saharienne.
 *
 * Supporte : Mobile Money (MTN, Airtel, Orange, Wave…), cartes Visa/MC
 * (hosted page PCI SAQ-A), USSD, virements.
 *
 * Sécurité :
 *   - SECRET_KEY + WEBHOOK_HASH lus via Vault (path par défaut : platform/payments/flutterwave_agg)
 *   - Jamais en process.env.
 *   - Webhook vérifié HMAC-SHA256 en temps constant (timingSafeEqual).
 *   - tx_ref = Idempotency-Key propagée depuis l'orchestrator.
 *
 * Doc : https://developer.flutterwave.com/reference
 */
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
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

const VAULT_PATH         = 'platform/payments/flutterwave_agg';
const API_BASE_URL       = 'https://api.flutterwave.com/v3';
const HTTP_TIMEOUT_MS    = 15_000;
const SECRET_CACHE_TTL_MS = 5 * 60 * 1_000;

@Injectable()
export class FlutterwaveAggregatorProvider implements IPaymentProvider {
  private readonly logger = new Logger(FlutterwaveAggregatorProvider.name);
  private readonly http: AxiosInstance;
  private secretKey:   string | null = null;
  private webhookHash: string | null = null;
  private keyCachedAt = 0;

  readonly meta: PaymentProviderMeta = {
    key:                 'flutterwave_agg',
    displayName:         'Flutterwave (Aggregator)',
    supportedMethods:    ['MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'USSD'],
    supportedCountries:  ['CG','CD','SN','CI','CM','GA','BF','ML','NG','GH','KE'],
    supportedCurrencies: ['XAF','XOF','NGN','GHS','KES','USD'],
    defaultVaultPath:    VAULT_PATH,
    credentialFields: [
      { key: 'SECRET_KEY',   label: 'Secret Key',   type: 'password', required: true, helpText: 'Commence par FLWSECK_TEST- (sandbox) ou FLWSECK- (prod) — Dashboard → Settings → API' },
      { key: 'WEBHOOK_HASH', label: 'Webhook Hash', type: 'password', required: true, helpText: 'Hash de vérification des webhooks (Dashboard → Settings → Webhooks)' },
    ],
  };

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {
    this.http = axios.create({
      baseURL: API_BASE_URL,
      timeout: HTTP_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Flag statique — le registry combine avec l'état DB (mode ≠ DISABLED). */
  get isEnabled(): boolean { return true; }
  readonly webhookSignatureHeader = 'verif-hash';

  supports(q: SupportsQuery): boolean {
    return this.meta.supportedMethods.includes(q.method)
        && this.meta.supportedCountries.includes(q.country)
        && this.meta.supportedCurrencies.includes(q.currency);
  }

  /**
   * Flutterwave supporte le split natif via le tableau `subaccounts[]` du
   * payload `/payments`. Le compte porteur de la SECRET_KEY (= compte
   * plateforme TransLog Pro) reçoit la commission ; le subaccount du tenant
   * reçoit `amount - transaction_charge - frais_flutterwave`.
   * Doc : https://developer.flutterwave.com/v3.0/docs/split-payments
   */
  supportsSplit(): boolean { return true; }

  async healthcheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const key = await this.getSecretKey();
      await this.http.get('/banks/NG', { headers: { Authorization: `Bearer ${key}` } });
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

    const payload: Record<string, unknown> = {
      tx_ref:          dto.txRef,
      amount:          dto.amount,
      currency:        dto.currency,
      redirect_url:    dto.redirectUrl,
      customer: {
        email:       dto.customerEmail ?? `${dto.txRef}@translogpro.noreply`,
        phonenumber: dto.customerPhone,
        name:        dto.customerName ?? 'Client TransLog',
      },
      meta:            dto.meta ?? {},
      payment_options: this.mapMethod(dto.method),
    };

    // Split natif : Flutterwave Subaccounts.
    // Sémantique : la `transaction_charge` (ici platformAmount) est PRÉLEVÉE
    // par le compte principal (porteur de la SECRET_KEY = plateforme), et le
    // reste est crédité au subaccount du tenant. Frais Flutterwave eux-mêmes
    // déduits du subaccount par défaut.
    if (dto.split && dto.split.tenantSubaccountId) {
      payload['subaccounts'] = [{
        id:                       dto.split.tenantSubaccountId,
        transaction_charge_type:  'flat',
        transaction_charge:       dto.split.platformAmount,
      }];
      this.logger.log(
        `[FLW] split tx_ref=${dto.txRef} platform=${dto.split.platformAmount} ` +
        `tenant=${dto.split.tenantAmount} → ${dto.split.tenantSubaccountId}`,
      );
    } else if (dto.split) {
      // Split demandé mais aucun subaccount tenant configuré : on encaisse en
      // legacy (tout chez la plateforme) ; l'orchestrator a déjà loggé l'event
      // SPLIT_SKIPPED_NO_SUBACCOUNT pour audit + payout T+1 manuel.
      this.logger.warn(
        `[FLW] split skipped tx_ref=${dto.txRef} — aucun tenantSubaccountId`,
      );
    }

    const { data } = await this.http.post(
      '/payments',
      payload,
      { headers: { Authorization: `Bearer ${key}` } },
    );

    this.logger.log(`[FLW] initiate tx_ref=${dto.txRef} status=${data.status}`);
    return {
      txRef:        dto.txRef,
      externalRef:  data.data?.id?.toString() ?? dto.txRef,
      status:       this.mapStatus(data.status),
      amount:       dto.amount,
      currency:     dto.currency,
      providerName: this.meta.key,
      paymentUrl:   data.data?.link,
    };
  }

  async verify(externalRef: string): Promise<PaymentResult> {
    const key = await this.getSecretKey();
    const { data } = await this.http.get(`/transactions/${externalRef}/verify`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const tx = data.data;
    // Tokenisation Flutterwave :
    //   - tx.customer.id            → customerRef (durable)
    //   - tx.card.token             → methodToken (réutilisable pour re-charge)
    //   - tx.card.last_4digits      → methodLast4 (UI)
    //   - tx.card.type              → methodBrand ("VISA", "MASTERCARD"…)
    // Les 3 derniers sont absents si la méthode n'est pas CARD.
    return {
      txRef:        tx.tx_ref,
      externalRef,
      status:       this.mapStatus(tx.status),
      amount:       tx.charged_amount,
      currency:     tx.currency,
      providerName: this.meta.key,
      processedAt:  tx.created_at ? new Date(tx.created_at) : undefined,
      customerRef:  tx.customer?.id ? String(tx.customer.id) : undefined,
      methodToken:  tx.card?.token  ? String(tx.card.token)  : undefined,
      methodLast4:  tx.card?.last_4digits,
      methodBrand:  tx.card?.type,
    };
  }

  async verifyWebhook(rawBody: Buffer, signature: string): Promise<WebhookVerificationResult> {
    const { webhookHash } = await this.getKeys();
    const computed = createHmac('sha256', webhookHash).update(rawBody).digest('hex');
    const sig  = Buffer.from(signature, 'hex');
    const comp = Buffer.from(computed,  'hex');
    if (sig.length !== comp.length || !timingSafeEqual(sig, comp)) {
      this.logger.warn('[FLW] webhook signature mismatch');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const tx   = body['data'] as Record<string, unknown>;
    const customer = tx['customer'] as Record<string, unknown> | undefined;
    const card     = tx['card']     as Record<string, unknown> | undefined;
    return {
      isValid:     true,
      txRef:       String(tx['tx_ref'] ?? ''),
      externalRef: String(tx['id']     ?? ''),
      status:      this.mapStatus(String(tx['status'] ?? '')),
      amount:      Number(tx['charged_amount'] ?? 0),
      currency:    String(tx['currency'] ?? 'XOF') as WebhookVerificationResult['currency'],
      meta:        (tx['meta'] ?? {}) as Record<string, unknown>,
      // Mêmes sources que verify() — Flutterwave envoie ces champs quand la
      // transaction succeed avec une carte ou un customer id connu.
      customerRef: customer?.['id'] ? String(customer['id']) : undefined,
      methodToken: card?.['token']  ? String(card['token'])  : undefined,
      methodLast4: card?.['last_4digits'] ? String(card['last_4digits']) : undefined,
      methodBrand: card?.['type']   ? String(card['type'])   : undefined,
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
      providerName: this.meta.key,
      processedAt:  new Date(),
    };
  }

  // ── Helpers privés ──────────────────────────────────────────────────────────

  private async getSecretKey(): Promise<string> {
    return (await this.getKeys()).secretKey;
  }

  private async getKeys(): Promise<{ secretKey: string; webhookHash: string }> {
    const now = Date.now();
    if (this.secretKey && this.webhookHash && now - this.keyCachedAt < SECRET_CACHE_TTL_MS) {
      return { secretKey: this.secretKey, webhookHash: this.webhookHash };
    }
    const s = await this.secretService.getSecretObject<{ SECRET_KEY: string; WEBHOOK_HASH: string }>(VAULT_PATH);
    if (!s.SECRET_KEY || !s.WEBHOOK_HASH) {
      throw new Error(`Flutterwave secrets missing in Vault (${VAULT_PATH})`);
    }
    this.secretKey   = s.SECRET_KEY;
    this.webhookHash = s.WEBHOOK_HASH;
    this.keyCachedAt = now;
    return { secretKey: this.secretKey, webhookHash: this.webhookHash };
  }

  private mapStatus(raw: string): PaymentStatus {
    switch (raw.toLowerCase()) {
      case 'successful':
      case 'success':
      case 'complete':  return 'SUCCESSFUL';
      case 'failed':
      case 'error':     return 'FAILED';
      case 'cancelled':
      case 'canceled':  return 'CANCELLED';
      case 'reversed':  return 'REVERSED';
      default:          return 'PENDING';
    }
  }

  private mapMethod(method: InitiatePaymentDto['method']): string {
    switch (method) {
      case 'MOBILE_MONEY':  return 'mobilemoneyssenegal,mobilemoneyghana,mobilemoneyuganda,mobilemoneyfranco';
      case 'CARD':          return 'card';
      case 'BANK_TRANSFER': return 'banktransfer';
      case 'USSD':          return 'ussd';
      default:              return 'card';
    }
  }
}
