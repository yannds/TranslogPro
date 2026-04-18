import { Module } from '@nestjs/common';
import { ActivationEmailsService } from './activation-emails.service';

/**
 * Drip d'activation post-signup — cron quotidien envoyant au plus 3 emails
 * par tenant (day1/day3/day7) selon l'avancement. IEmailService (global) est
 * le seul point d'envoi ; le provider actif dépend de EMAIL_PROVIDER.
 *
 * Toggle runtime : `ACTIVATION_EMAILS_ENABLED=false` désactive le cron sans
 * redémarrer l'app. Audit : chaque envoi loggé + persisté dans
 * Tenant.activationEmailsSent.
 */
@Module({
  providers: [ActivationEmailsService],
})
export class ActivationEmailsModule {}
