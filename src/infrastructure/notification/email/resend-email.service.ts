import { Injectable, Logger, Inject } from '@nestjs/common';
import axios from 'axios';
import type {
  IEmailService, SendEmailDto, SendEmailResult, EmailProviderName,
} from '../interfaces/email.interface';
import { ISecretService, SECRET_SERVICE } from '../../secret/interfaces/secret.interface';
import {
  toAddressArray, toAddress, formatAddress, maskEmail,
} from './email.helpers';

/**
 * ResendEmailService — Envoi via Resend REST API (resend.com).
 *
 * Config Vault `platform/email/resend` :
 *   {
 *     API_KEY:     "re_•••••••••••••••••",
 *     FROM_EMAIL:  "noreply@votredomaine.com",  // doit être vérifié côté Resend
 *     FROM_NAME:   "TransLog Pro"               // optionnel
 *   }
 *
 * Doc : https://resend.com/docs/api-reference/emails/send-email
 *
 * Zéro SDK — appel REST direct.
 */
interface ResendCredentials {
  API_KEY:     string;
  FROM_EMAIL:  string;
  FROM_NAME?:  string;
}

const RESEND_BASE = 'https://api.resend.com';

@Injectable()
export class ResendEmailService implements IEmailService {
  public readonly providerName: EmailProviderName = 'resend';
  private readonly logger = new Logger(ResendEmailService.name);
  private credsCache: { creds: ResendCredentials; cachedAt: number } | null = null;
  private readonly CREDS_TTL_MS = 5 * 60 * 1_000;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendEmailDto): Promise<SendEmailResult> {
    const creds = await this.getCreds();

    const toList  = toAddressArray(dto.to).map(formatAddress);
    const ccList  = toAddressArray(dto.cc).map(formatAddress);
    const bccList = toAddressArray(dto.bcc).map(formatAddress);

    const from = toAddress(dto.from) ?? {
      email: creds.FROM_EMAIL,
      name:  creds.FROM_NAME,
    };
    const replyTo = toAddress(dto.replyTo);

    if (!dto.html && !dto.text) {
      throw new Error('ResendEmailService.send: au moins html ou text doit être fourni');
    }

    const payload: Record<string, unknown> = {
      from:    formatAddress(from),
      to:      toList,
      subject: dto.subject,
      ...(ccList.length  ? { cc:  ccList  } : {}),
      ...(bccList.length ? { bcc: bccList } : {}),
      ...(dto.html    ? { html: dto.html } : {}),
      ...(dto.text    ? { text: dto.text } : {}),
      ...(replyTo     ? { reply_to: formatAddress(replyTo) } : {}),
      ...(dto.tags    ? { tags: dto.tags.map(name => ({ name })) } : {}),
      ...(dto.headers ? { headers: dto.headers } : {}),
    };

    try {
      const { data } = await axios.post(
        `${RESEND_BASE}/emails`,
        payload,
        {
          headers: {
            Authorization:  `Bearer ${creds.API_KEY}`,
            'Content-Type': 'application/json',
            ...(dto.idempotencyKey ? { 'Idempotency-Key': dto.idempotencyKey } : {}),
          },
          timeout: 15_000,
        },
      );

      this.logger.log(
        `[Resend] Sent to=${toAddressArray(dto.to).map(a => maskEmail(a.email)).join(',')} id=${data.id}`,
      );

      return {
        messageId: String(data.id ?? ''),
        provider:  this.providerName,
        sentAt:    new Date(),
        accepted:  true,
      };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        : String(err);
      this.logger.error(`[Resend] Send failed: ${msg}`);
      throw new Error(`Resend email send failed: ${msg}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: EmailProviderName; detail?: string }> {
    try {
      const creds = await this.getCreds();
      // Resend n'a pas de ping public — on vérifie juste la présence de la clé.
      const valid = /^re_[A-Za-z0-9_]+$/.test(creds.API_KEY);
      return {
        ok: valid,
        provider: this.providerName,
        detail: valid ? 'API key format OK' : 'API key format suspect',
      };
    } catch (err) {
      return { ok: false, provider: this.providerName, detail: (err as Error).message };
    }
  }

  private async getCreds(): Promise<ResendCredentials> {
    const now = Date.now();
    if (this.credsCache && now - this.credsCache.cachedAt < this.CREDS_TTL_MS) {
      return this.credsCache.creds;
    }
    const creds = await this.secretService.getSecretObject<ResendCredentials>('platform/email/resend');
    if (!creds.API_KEY || !creds.FROM_EMAIL) {
      throw new Error('Secret Resend incomplet : API_KEY et FROM_EMAIL requis');
    }
    this.credsCache = { creds, cachedAt: now };
    return creds;
  }
}
