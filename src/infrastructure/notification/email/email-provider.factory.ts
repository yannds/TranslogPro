import { Logger } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import type { IEmailService, EmailProviderName } from '../interfaces/email.interface';
import { EMAIL_SERVICE } from '../interfaces/email.interface';
import { ConsoleEmailService } from './console-email.service';
import { O365EmailService }    from './o365-email.service';
import { ResendEmailService }  from './resend-email.service';
import { SmtpEmailService }    from './smtp-email.service';

const logger = new Logger('EmailProviderFactory');

/**
 * Sélection du provider email actif.
 *
 * Pilotée par la variable d'environnement `EMAIL_PROVIDER` :
 *   - `console` (défaut)  → ConsoleEmailService   (dev uniquement — log stdout)
 *   - `o365`              → O365EmailService      (Microsoft 365 / Graph API)
 *   - `resend`            → ResendEmailService    (Resend REST)
 *   - `smtp`              → SmtpEmailService      (stub — à câbler avec nodemailer)
 *
 * Garde-fou production : en `NODE_ENV=production`, `console` est REFUSÉ —
 * l'app crashe au démarrage pour éviter le silence radio.
 */
function pickProvider(): EmailProviderName {
  const raw = (process.env.EMAIL_PROVIDER ?? 'console').toLowerCase().trim();
  const valid: EmailProviderName[] = ['console', 'o365', 'resend', 'smtp'];
  if (!(valid as string[]).includes(raw)) {
    logger.warn(`EMAIL_PROVIDER="${raw}" inconnu — fallback sur "console"`);
    return 'console';
  }
  const picked = raw as EmailProviderName;

  if (picked === 'console' && process.env.NODE_ENV === 'production') {
    throw new Error(
      'EMAIL_PROVIDER=console interdit en production. Configurer o365|resend|smtp via EMAIL_PROVIDER.',
    );
  }

  return picked;
}

/**
 * Provider Nest qui résout `EMAIL_SERVICE` vers l'implémentation choisie.
 *
 * Toutes les implémentations sont instanciées par Nest (constructeurs légers,
 * aucune I/O) — la factory ne fait que choisir laquelle exporter. Cela permet :
 *   - Tests : remplacer par un mock unique sur EMAIL_SERVICE, sans toucher aux 4 services
 *   - Health-check : possibilité d'inspecter les 4 implémentations
 *   - Switch dynamique : `kill -HUP` + nouvelle env = nouveau provider au prochain boot
 */
export const EMAIL_SERVICE_PROVIDER: Provider = {
  provide: EMAIL_SERVICE,
  inject:  [ConsoleEmailService, O365EmailService, ResendEmailService, SmtpEmailService],
  useFactory: (
    consoleSvc: ConsoleEmailService,
    o365Svc:    O365EmailService,
    resendSvc:  ResendEmailService,
    smtpSvc:    SmtpEmailService,
  ): IEmailService => {
    const name = pickProvider();
    logger.log(`Email provider actif : ${name}`);
    switch (name) {
      case 'console': return consoleSvc;
      case 'o365':    return o365Svc;
      case 'resend':  return resendSvc;
      case 'smtp':    return smtpSvc;
    }
  },
};
