import { Injectable, Logger, Inject } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type {
  IEmailService, SendEmailDto, SendEmailResult, EmailProviderName,
} from '../interfaces/email.interface';
import { ISecretService, SECRET_SERVICE } from '../../secret/interfaces/secret.interface';
import { WhiteLabelService } from '../../../modules/white-label/white-label.service';
import {
  toAddressArray, toAddress, formatAddress, maskEmail,
} from './email.helpers';

/**
 * SmtpEmailService — provider SMTP générique via nodemailer.
 *
 * Config Vault `platform/email/smtp` :
 *   {
 *     HOST:        "smtp.votredomaine.com",
 *     PORT:        "587",                    // string (Vault KV v2 stocke des strings)
 *     USER:        "no-reply@votredomaine.com",
 *     PASS:        "••••••••••",
 *     SECURE:      "false",                  // "true" pour port 465, "false" pour STARTTLS 587
 *     FROM_EMAIL:  "noreply@votredomaine.com",
 *     FROM_NAME:   "TransLog Pro"            // optionnel
 *   }
 *
 * Pool de connexions : nodemailer gère un pool de 5 sockets TCP avec keep-alive.
 * Le transporter est créé à la première soumission puis réutilisé — les
 * credentials sont mis en cache 5 min et provoquent un rebuild si changement.
 *
 * Aucune donnée sensible en log. Mails délivrables via vérification DKIM/SPF
 * à configurer côté domaine d'envoi (hors scope du service).
 */
interface SmtpCredentials {
  HOST:        string;
  PORT:        string;
  USER:        string;
  PASS:        string;
  SECURE:      string;
  FROM_EMAIL:  string;
  FROM_NAME?:  string;
}

@Injectable()
export class SmtpEmailService implements IEmailService {
  public readonly providerName: EmailProviderName = 'smtp';
  private readonly logger = new Logger(SmtpEmailService.name);
  private credsCache: { creds: SmtpCredentials; cachedAt: number } | null = null;
  private transporter: Transporter | null = null;
  private readonly CREDS_TTL_MS = 5 * 60 * 1_000;

  constructor(
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
    private readonly brand:                       WhiteLabelService,
  ) {}

  async send(dto: SendEmailDto): Promise<SendEmailResult> {
    const creds       = await this.getCreds();
    const transporter = await this.getTransporter(creds);

    const toList  = toAddressArray(dto.to).map(formatAddress);
    const ccList  = toAddressArray(dto.cc).map(formatAddress);
    const bccList = toAddressArray(dto.bcc).map(formatAddress);

    // Résolution from/replyTo : `dto.from` explicite > branding tenant
    // (via WhiteLabelService) > défaut plateforme lu depuis Vault.
    const explicitFrom = toAddress(dto.from);
    const resolved = explicitFrom
      ? { from: explicitFrom, replyTo: toAddress(dto.replyTo) }
      : await this.brand.resolveFromForTenant(dto.tenantId ?? null, {
          fromName:    creds.FROM_NAME ?? '',
          fromAddress: creds.FROM_EMAIL,
          replyTo:     toAddress(dto.replyTo)?.email,
        });
    const from    = resolved.from;
    const replyTo = resolved.replyTo;

    if (!dto.html && !dto.text) {
      throw new Error('SmtpEmailService.send: au moins html ou text doit être fourni');
    }

    try {
      const info = await transporter.sendMail({
        from:    formatAddress(from),
        to:      toList.join(', '),
        cc:      ccList.length  ? ccList.join(', ')  : undefined,
        bcc:     bccList.length ? bccList.join(', ') : undefined,
        replyTo: replyTo ? formatAddress(replyTo) : undefined,
        subject: dto.subject,
        html:    dto.html,
        text:    dto.text,
        headers: dto.headers,
        // nodemailer n'a pas de notion d'idempotency — on met l'ID dans un header
        // custom pour aider les MTA qui dedupliquent (rare).
        ...(dto.idempotencyKey
          ? { headers: { ...dto.headers, 'X-Idempotency-Key': dto.idempotencyKey } }
          : {}),
      });

      this.logger.log(
        `[SMTP] Sent to=${toAddressArray(dto.to).map(a => maskEmail(a.email)).join(',')} id=${info.messageId}`,
      );

      return {
        messageId: info.messageId ?? '',
        provider:  this.providerName,
        sentAt:    new Date(),
        accepted:  Array.isArray(info.accepted) && info.accepted.length > 0,
      };
    } catch (err: unknown) {
      const msg = (err as Error).message || String(err);
      this.logger.error(`[SMTP] Send failed: ${msg}`);
      // En cas d'erreur, on détruit le transporter pour forcer un reconnect
      // au prochain essai (évite de garder une socket morte dans le pool).
      this.transporter?.close();
      this.transporter = null;
      throw new Error(`SMTP email send failed: ${msg}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; provider: EmailProviderName; detail?: string }> {
    try {
      const creds = await this.getCreds();
      const transporter = await this.getTransporter(creds);
      // nodemailer `verify()` tente une connexion + auth. Parfait health-check.
      await transporter.verify();
      return { ok: true, provider: this.providerName, detail: 'SMTP auth succeeded' };
    } catch (err) {
      return { ok: false, provider: this.providerName, detail: (err as Error).message };
    }
  }

  // ─── Credentials (Vault) ────────────────────────────────────────────────────

  private async getCreds(): Promise<SmtpCredentials> {
    const now = Date.now();
    if (this.credsCache && now - this.credsCache.cachedAt < this.CREDS_TTL_MS) {
      return this.credsCache.creds;
    }
    const raw = await this.secretService.getSecretObject<SmtpCredentials>('platform/email/smtp');
    if (!raw) throw new Error('Secrets SMTP manquants à "platform/email/smtp"');
    if (!raw.HOST || !raw.PORT || !raw.USER || !raw.PASS || !raw.FROM_EMAIL) {
      throw new Error('Secret SMTP incomplet : HOST, PORT, USER, PASS, FROM_EMAIL requis');
    }
    // Détruire le transporter si les credentials ont changé
    if (this.credsCache && JSON.stringify(this.credsCache.creds) !== JSON.stringify(raw)) {
      this.transporter?.close();
      this.transporter = null;
    }
    this.credsCache = { creds: raw, cachedAt: now };
    return raw;
  }

  private async getTransporter(creds: SmtpCredentials): Promise<Transporter> {
    if (this.transporter) return this.transporter;
    const port = Number.parseInt(creds.PORT, 10);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`SMTP PORT invalide : "${creds.PORT}"`);
    }
    this.transporter = nodemailer.createTransport({
      host: creds.HOST,
      port,
      // "secure" = TLS natif (port 465). Sinon STARTTLS opportuniste (port 587).
      secure: creds.SECURE === 'true',
      auth:   { user: creds.USER, pass: creds.PASS },
      pool:   true,
      maxConnections: 5,
      maxMessages:    100,
      connectionTimeout: 10_000,
      greetingTimeout:   10_000,
      socketTimeout:     30_000,
    });
    return this.transporter;
  }
}
