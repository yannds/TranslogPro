import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailService, SendEmailDto, SendEmailResult, EmailProviderName,
} from '../interfaces/email.interface';
import {
  toAddressArray, toAddress, formatAddress, generateLocalMessageId, maskEmail,
} from './email.helpers';

/**
 * ConsoleEmailService — provider de développement.
 *
 * Aucune dépendance externe. Aucun email n'est réellement envoyé : chaque appel
 * est journalisé avec un bloc structuré (visible dans la stdout de l'app).
 *
 * Activation : `EMAIL_PROVIDER=console` (défaut en l'absence de la variable).
 *
 * Production : NE JAMAIS utiliser. EmailProviderFactory refuse ce provider
 * si NODE_ENV=production (l'app démarre en erreur pour éviter la silence).
 */
@Injectable()
export class ConsoleEmailService implements IEmailService {
  public readonly providerName: EmailProviderName = 'console';
  private readonly logger = new Logger(ConsoleEmailService.name);

  async send(dto: SendEmailDto): Promise<SendEmailResult> {
    const to  = toAddressArray(dto.to);
    const cc  = toAddressArray(dto.cc);
    const bcc = toAddressArray(dto.bcc);
    const from = toAddress(dto.from);

    const messageId = generateLocalMessageId(this.providerName);
    const sentAt    = new Date();

    // Bloc formaté pour se repérer dans les logs — structure stable.
    const block = [
      '',
      '┌─[ EMAIL · console provider — dev only ]──────────────────',
      `│ messageId : ${messageId}`,
      `│ sentAt    : ${sentAt.toISOString()}`,
      `│ from      : ${from ? formatAddress(from) : '(default)'}`,
      `│ to        : ${to.map(a => maskEmail(a.email)).join(', ')}`,
      ...(cc.length  ? [`│ cc        : ${cc.map(a  => maskEmail(a.email)).join(', ')}`] : []),
      ...(bcc.length ? [`│ bcc       : ${bcc.map(a => maskEmail(a.email)).join(', ')}`] : []),
      `│ subject   : ${dto.subject}`,
      `│ category  : ${dto.category ?? 'transactional'}`,
      ...(dto.tenantId ? [`│ tenantId  : ${dto.tenantId}`] : []),
      '├─────────────────────────────────────────────────────────',
      `│ text (${(dto.text ?? '').length} chars) preview:`,
      ...(dto.text ? dto.text.split('\n').slice(0, 8).map(l => `│   ${l}`) : ['│   (no plain-text part)']),
      '├─────────────────────────────────────────────────────────',
      `│ html: ${(dto.html ?? '').length} chars`,
      '└─────────────────────────────────────────────────────────',
      '',
    ].join('\n');

    this.logger.log(block);

    return {
      messageId,
      provider: this.providerName,
      sentAt,
      accepted: false, // never actually delivered — caller must know this is dev-only
    };
  }

  async healthCheck(): Promise<{ ok: true; provider: EmailProviderName; detail: string }> {
    return {
      ok: true,
      provider: this.providerName,
      detail: 'console provider — no network call performed',
    };
  }
}
