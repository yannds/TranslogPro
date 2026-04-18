import { Injectable, Logger, Inject } from '@nestjs/common';
import axios from 'axios';
import type {
  IEmailService, SendEmailDto, SendEmailResult, EmailProviderName,
} from '../interfaces/email.interface';
import { ISecretService, SECRET_SERVICE } from '../../secret/interfaces/secret.interface';
import {
  toAddressArray, toAddress, generateLocalMessageId, maskEmail,
} from './email.helpers';

/**
 * O365EmailService — Envoi via Microsoft Graph API (app-only OAuth 2.0).
 *
 * Config requise (Vault, chemin `platform/email/o365`) :
 *   {
 *     TENANT_ID:     "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",  // Azure AD tenant
 *     CLIENT_ID:     "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",  // App registration
 *     CLIENT_SECRET: "••••••••••••••••",                       // "clé de l'appli"
 *     SENDER_EMAIL:  "noreply@votredomaine.com",               // UPN boîte autorisée
 *     SENDER_NAME:   "TransLog Pro"                            // optionnel
 *   }
 *
 * Permissions Graph requises (application, PAS délégué) :
 *   Mail.Send (Application)  — accordée par un admin Azure AD
 *
 * Protocole :
 *   1. POST https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token
 *      grant_type=client_credentials&scope=https://graph.microsoft.com/.default
 *      → access_token (TTL ~1h)
 *   2. POST https://graph.microsoft.com/v1.0/users/{SENDER_EMAIL}/sendMail
 *      Authorization: Bearer <token>
 *      { message: {...}, saveToSentItems: true }
 *
 * Cache token : mémoire en RAM jusqu'à 60s avant expiration (refresh préventif).
 * Aucun SDK tiers requis — fetch-only.
 */
interface O365Credentials {
  TENANT_ID:      string;
  CLIENT_ID:      string;
  CLIENT_SECRET:  string;
  SENDER_EMAIL:   string;
  SENDER_NAME?:   string;
}

interface CachedToken {
  accessToken: string;
  expiresAt:   number; // epoch ms
}

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const LOGIN_BASE = 'https://login.microsoftonline.com';
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

@Injectable()
export class O365EmailService implements IEmailService {
  public readonly providerName: EmailProviderName = 'o365';
  private readonly logger = new Logger(O365EmailService.name);
  private tokenCache: CachedToken | null = null;
  private credsCache: { creds: O365Credentials; cachedAt: number } | null = null;
  private readonly CREDS_TTL_MS = 5 * 60 * 1_000;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendEmailDto): Promise<SendEmailResult> {
    const creds = await this.getCreds();
    const token = await this.getAccessToken(creds);

    const toList  = toAddressArray(dto.to);
    const ccList  = toAddressArray(dto.cc);
    const bccList = toAddressArray(dto.bcc);
    const from    = toAddress(dto.from) ?? {
      email: creds.SENDER_EMAIL,
      name:  creds.SENDER_NAME,
    };
    const replyTo = toAddress(dto.replyTo);

    if (!dto.html && !dto.text) {
      throw new Error('O365EmailService.send: au moins html ou text doit être fourni');
    }

    // Format Graph : https://learn.microsoft.com/en-us/graph/api/user-sendmail
    const graphMessage = {
      message: {
        subject:      dto.subject,
        body: {
          contentType: dto.html ? 'HTML' : 'Text',
          content:     dto.html ?? dto.text ?? '',
        },
        from: from.email === creds.SENDER_EMAIL
          ? undefined // Graph utilise l'UPN du path, pas besoin de "from"
          : { emailAddress: { address: from.email, name: from.name } },
        toRecipients:  toList.map(a  => ({ emailAddress: { address: a.email, name: a.name } })),
        ccRecipients:  ccList.map(a  => ({ emailAddress: { address: a.email, name: a.name } })),
        bccRecipients: bccList.map(a => ({ emailAddress: { address: a.email, name: a.name } })),
        ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo.email, name: replyTo.name } }] } : {}),
        ...(dto.headers ? { internetMessageHeaders: Object.entries(dto.headers)
          // Graph n'accepte que les headers préfixés x- ou list-
          .filter(([k]) => /^(x-|list-)/i.test(k))
          .map(([name, value]) => ({ name, value })) } : {}),
      },
      saveToSentItems: true,
    };

    const url = `${GRAPH_BASE}/users/${encodeURIComponent(creds.SENDER_EMAIL)}/sendMail`;

    try {
      await axios.post(url, graphMessage, {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15_000,
      });

      // Graph ne retourne pas d'ID message — on en génère un local pour les logs.
      const messageId = generateLocalMessageId(this.providerName);
      this.logger.log(
        `[O365] Sent to=${toList.map(a => maskEmail(a.email)).join(',')} subject="${dto.subject}"`,
      );

      return {
        messageId,
        provider: this.providerName,
        sentAt:   new Date(),
        accepted: true,
      };
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        : String(err);
      this.logger.error(`[O365] Send failed: ${msg}`);
      // Invalidate token on 401 — token a pu expirer côté Graph avant notre TTL.
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        this.tokenCache = null;
      }
      throw new Error(`O365 email send failed: ${msg}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: EmailProviderName; detail?: string }> {
    try {
      const creds = await this.getCreds();
      await this.getAccessToken(creds);
      return { ok: true, provider: this.providerName, detail: 'oauth2 token acquired' };
    } catch (err) {
      return { ok: false, provider: this.providerName, detail: (err as Error).message };
    }
  }

  // ─── Credentials (Vault) ────────────────────────────────────────────────────

  private async getCreds(): Promise<O365Credentials> {
    const now = Date.now();
    if (this.credsCache && now - this.credsCache.cachedAt < this.CREDS_TTL_MS) {
      return this.credsCache.creds;
    }
    const creds = await this.secretService.getSecretObject<O365Credentials>('platform/email/o365');
    if (!creds.TENANT_ID || !creds.CLIENT_ID || !creds.CLIENT_SECRET || !creds.SENDER_EMAIL) {
      throw new Error('Secret O365 incomplet : TENANT_ID, CLIENT_ID, CLIENT_SECRET, SENDER_EMAIL requis');
    }
    this.credsCache = { creds, cachedAt: now };
    return creds;
  }

  // ─── OAuth 2.0 token (client_credentials) ──────────────────────────────────

  private async getAccessToken(creds: O365Credentials): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt - TOKEN_REFRESH_MARGIN_MS > now) {
      return this.tokenCache.accessToken;
    }

    const url = `${LOGIN_BASE}/${creds.TENANT_ID}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id:     creds.CLIENT_ID,
      client_secret: creds.CLIENT_SECRET,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials',
    });

    try {
      const { data } = await axios.post(url, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10_000,
      });
      const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      this.tokenCache = {
        accessToken: data.access_token as string,
        expiresAt:   now + expiresIn * 1000,
      };
      return this.tokenCache.accessToken;
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? `${err.response?.status} ${JSON.stringify(err.response?.data)}`
        : String(err);
      throw new Error(`O365 token acquisition failed: ${msg}`);
    }
  }
}
