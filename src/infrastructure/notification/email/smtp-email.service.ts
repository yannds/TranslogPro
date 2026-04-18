import { Injectable, Logger } from '@nestjs/common';
import type {
  IEmailService, SendEmailDto, SendEmailResult, EmailProviderName,
} from '../interfaces/email.interface';

/**
 * SmtpEmailService — placeholder pour un provider SMTP générique.
 *
 * Le câblage complet nécessite d'installer `nodemailer` et de lire les
 * credentials depuis Vault `platform/email/smtp` :
 *   { HOST, PORT, USER, PASS, SECURE (bool), FROM_EMAIL, FROM_NAME? }
 *
 * Activation future :
 *   1. `npm install nodemailer @types/nodemailer`
 *   2. Décommenter l'implémentation réelle dans `send()`
 *   3. Déclarer le secret Vault correspondant
 *
 * Tant que le câblage n'est pas fait, ce provider lève explicitement pour
 * éviter qu'un déploiement en production ne passe inaperçu avec `EMAIL_PROVIDER=smtp`.
 */
@Injectable()
export class SmtpEmailService implements IEmailService {
  public readonly providerName: EmailProviderName = 'smtp';
  private readonly logger = new Logger(SmtpEmailService.name);

  async send(_dto: SendEmailDto): Promise<SendEmailResult> {
    this.logger.error('[SMTP] Provider non câblé — installer nodemailer et implémenter send()');
    throw new Error(
      'SmtpEmailService not implemented — installer nodemailer et compléter le service avant activation',
    );
  }

  async healthCheck(): Promise<{ ok: false; provider: EmailProviderName; detail: string }> {
    return {
      ok: false,
      provider: this.providerName,
      detail: 'SmtpEmailService not implemented yet',
    };
  }
}
