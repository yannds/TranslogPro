import { Module, Global } from '@nestjs/common';
import { TwilioSmsService, TwilioWhatsappService } from './twilio.service';
import { SMS_SERVICE, WHATSAPP_SERVICE } from './interfaces/sms.interface';
import { EMAIL_SERVICE } from './interfaces/email.interface';
import { ConsoleEmailService } from './email/console-email.service';
import { O365EmailService }    from './email/o365-email.service';
import { ResendEmailService }  from './email/resend-email.service';
import { SmtpEmailService }    from './email/smtp-email.service';
import { EMAIL_SERVICE_PROVIDER } from './email/email-provider.factory';

/**
 * NotificationProviderModule — fournit ISmsService, IWhatsappService
 * et IEmailService globalement.
 *
 * Découplage complet : les modules métier (NotificationModule, ticketing,
 * public-signup, SAV…) injectent SMS_SERVICE, WHATSAPP_SERVICE ou EMAIL_SERVICE
 * sans connaître le provider derrière.
 *
 * Email : le provider est choisi au boot par la variable d'env `EMAIL_PROVIDER`
 * (console|o365|resend|smtp) — voir EmailProviderFactory.
 * Les 4 implémentations sont instanciées (constructeurs légers) pour permettre
 * le switch sans redémarrage de module et faciliter les health-checks.
 *
 * Pour switcher le provider SMS → remplacer useClass de SMS_SERVICE uniquement.
 */
@Global()
@Module({
  providers: [
    { provide: SMS_SERVICE,      useClass: TwilioSmsService      },
    { provide: WHATSAPP_SERVICE, useClass: TwilioWhatsappService },
    // Email : chaque implémentation enregistrée + factory qui choisit EMAIL_SERVICE
    ConsoleEmailService,
    O365EmailService,
    ResendEmailService,
    SmtpEmailService,
    EMAIL_SERVICE_PROVIDER,
  ],
  exports: [SMS_SERVICE, WHATSAPP_SERVICE, EMAIL_SERVICE],
})
export class NotificationProviderModule {}
