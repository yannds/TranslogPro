import { Injectable, Logger, Inject } from '@nestjs/common';
import axios from 'axios';
import {
  ISmsService,
  IWhatsappService,
  SendSmsDto,
  SendSmsResult,
} from './interfaces/sms.interface';
import { ISecretService, SECRET_SERVICE } from '../secret/interfaces/secret.interface';

/**
 * Credentials Twilio lus depuis Vault KV v2.
 * Chemin tenant  : "tenants/{tenantId}/sms" → { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
 * Chemin platform: "platform/sms"           → fallback si tenant non configuré
 * WhatsApp       : "platform/whatsapp"      → { ACCOUNT_SID, AUTH_TOKEN, FROM_NUMBER }
 *
 * FROM_NUMBER pour WhatsApp : "whatsapp:+1XXXXXXXXXX"
 */
interface TwilioCredentials {
  ACCOUNT_SID:  string;
  AUTH_TOKEN:   string;
  FROM_NUMBER:  string;
}

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';

/**
 * TwilioSmsService — SMS via Twilio REST API (sans SDK tiers).
 *
 * Sécurité :
 *   - Authentification Basic(accountSid:authToken) — jamais dans les headers publics
 *   - Credentials depuis Vault, cache mémoire 5min par tenant
 *   - timeout 10s — évite de bloquer la transaction métier sur un appel externe
 */
@Injectable()
export class TwilioSmsService implements ISmsService {
  private readonly logger = new Logger(TwilioSmsService.name);
  // Cache par tenantId : évite un aller Vault à chaque SMS
  private readonly credCache = new Map<string, { creds: TwilioCredentials; cachedAt: number }>();
  private readonly KEY_TTL_MS = 5 * 60 * 1_000;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendSmsDto): Promise<SendSmsResult> {
    const creds = await this.getCredentials(dto.tenantId);

    const params = new URLSearchParams({
      To:   dto.to,
      From: dto.from ?? creds.FROM_NUMBER,
      Body: dto.body,
    });

    try {
      const { data } = await axios.post(
        `${TWILIO_BASE}/Accounts/${creds.ACCOUNT_SID}/Messages.json`,
        params.toString(),
        {
          auth:    { username: creds.ACCOUNT_SID, password: creds.AUTH_TOKEN },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );

      this.logger.log(`[SMS] Sent to ${dto.to} sid=${data.sid} status=${data.status}`);

      return {
        sid:    data.sid,
        status: data.status as SendSmsResult['status'],
        to:     dto.to,
        sentAt: new Date(),
      };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        : String(err);
      this.logger.error(`[SMS] Send failed to=${dto.to}: ${msg}`);
      throw new Error(`SMS send failed: ${msg}`);
    }
  }

  async healthCheck(tenantId: string): Promise<boolean> {
    try {
      const creds = await this.getCredentials(tenantId);
      const { data } = await axios.get(
        `${TWILIO_BASE}/Accounts/${creds.ACCOUNT_SID}.json`,
        { auth: { username: creds.ACCOUNT_SID, password: creds.AUTH_TOKEN }, timeout: 5_000 },
      );
      return data.status === 'active';
    } catch {
      return false;
    }
  }

  private async getCredentials(tenantId: string): Promise<TwilioCredentials> {
    const now    = Date.now();
    const cached = this.credCache.get(tenantId);
    if (cached && now - cached.cachedAt < this.KEY_TTL_MS) return cached.creds;

    // Essai clé tenant d'abord, fallback platform
    let creds: TwilioCredentials;
    try {
      creds = await this.secretService.getSecretObject<TwilioCredentials>(
        `tenants/${tenantId}/sms`,
      );
    } catch {
      creds = await this.secretService.getSecretObject<TwilioCredentials>('platform/sms');
    }

    if (!creds.ACCOUNT_SID || !creds.AUTH_TOKEN || !creds.FROM_NUMBER) {
      throw new Error(`Twilio credentials manquants dans Vault pour tenant ${tenantId}`);
    }

    this.credCache.set(tenantId, { creds, cachedAt: now });
    return creds;
  }
}

/**
 * TwilioWhatsappService — WhatsApp Business via Twilio.
 * Même mécanisme que TwilioSmsService, FROM formaté "whatsapp:+1XXXXXXXXXX".
 * Clé Vault: "platform/whatsapp" (shared — WhatsApp Business est tenant-agnostic).
 */
@Injectable()
export class TwilioWhatsappService implements IWhatsappService {
  private readonly logger = new Logger(TwilioWhatsappService.name);
  private cachedCreds: TwilioCredentials | null = null;
  private cacheAt = 0;
  private readonly KEY_TTL_MS = 5 * 60 * 1_000;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendSmsDto): Promise<SendSmsResult> {
    const creds = await this.getCredentials();

    // WhatsApp nécessite le préfixe "whatsapp:" sur To et From
    const to   = dto.to.startsWith('whatsapp:') ? dto.to   : `whatsapp:${dto.to}`;
    const from = creds.FROM_NUMBER.startsWith('whatsapp:')
      ? creds.FROM_NUMBER
      : `whatsapp:${creds.FROM_NUMBER}`;

    const params = new URLSearchParams({ To: to, From: from, Body: dto.body });

    try {
      const { data } = await axios.post(
        `${TWILIO_BASE}/Accounts/${creds.ACCOUNT_SID}/Messages.json`,
        params.toString(),
        {
          auth:    { username: creds.ACCOUNT_SID, password: creds.AUTH_TOKEN },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10_000,
        },
      );

      this.logger.log(`[WA] Sent to ${dto.to} sid=${data.sid}`);
      return { sid: data.sid, status: data.status, to: dto.to, sentAt: new Date() };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        : String(err);
      this.logger.error(`[WA] Send failed to=${dto.to}: ${msg}`);
      throw new Error(`WhatsApp send failed: ${msg}`);
    }
  }

  async healthCheck(_tenantId: string): Promise<boolean> {
    try { await this.getCredentials(); return true; }
    catch { return false; }
  }

  private async getCredentials(): Promise<TwilioCredentials> {
    const now = Date.now();
    if (this.cachedCreds && now - this.cacheAt < this.KEY_TTL_MS) return this.cachedCreds;
    const creds = await this.secretService.getSecretObject<TwilioCredentials>('platform/whatsapp');
    if (!creds.ACCOUNT_SID || !creds.AUTH_TOKEN || !creds.FROM_NUMBER) {
      throw new Error('WhatsApp credentials manquants dans Vault (platform/whatsapp)');
    }
    this.cachedCreds = creds;
    this.cacheAt     = now;
    return creds;
  }
}
