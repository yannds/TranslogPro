import { Module, Global } from '@nestjs/common';
import { TwilioSmsService, TwilioWhatsappService } from './twilio.service';
import { SMS_SERVICE, WHATSAPP_SERVICE } from './interfaces/sms.interface';

/**
 * NotificationProviderModule — fournit ISmsService et IWhatsappService globalement.
 *
 * Découplage complet : les modules métier (NotificationModule, ticketing, SAV...)
 * injectent SMS_SERVICE ou WHATSAPP_SERVICE sans connaître Twilio.
 *
 * Pour switcher vers un autre provider (Vonage, AWS SNS) :
 *   remplacer useClass ici uniquement — zéro modification dans le code métier.
 */
@Global()
@Module({
  providers: [
    { provide: SMS_SERVICE,      useClass: TwilioSmsService      },
    { provide: WHATSAPP_SERVICE, useClass: TwilioWhatsappService },
  ],
  exports: [SMS_SERVICE, WHATSAPP_SERVICE],
})
export class NotificationProviderModule {}
