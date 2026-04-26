import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { LifecycleNotificationListener } from './lifecycle-notification.listener';
import { InvoiceNotificationListener }   from './invoice-notification.listener';
import { InvoiceOverdueScheduler }       from './invoice-overdue.scheduler';

/**
 * NotificationModule — consomme ISmsService et IWhatsappService fournis
 * globalement par NotificationProviderModule (app.module.ts) ; PrismaService
 * et PlatformConfigService sont aussi @Global, pas besoin d'imports ici.
 *
 * Listeners enregistrés :
 *   - LifecycleNotificationListener : 5 events voyageur (achat, publication,
 *     embarquement, rappels, arrivée).
 *   - InvoiceNotificationListener   : 4 events facturation (issued, paid,
 *     overdue, cancelled) — Tier 1.1 chantier email 2026-04-26.
 *
 * Schedulers :
 *   - InvoiceOverdueScheduler : @Cron quotidien 07h UTC qui détecte les
 *     factures ISSUED en retard et émet INVOICE_OVERDUE (idempotent).
 */
@Module({
  controllers: [NotificationController],
  providers:   [
    NotificationService,
    LifecycleNotificationListener,
    InvoiceNotificationListener,
    InvoiceOverdueScheduler,
  ],
  exports:     [NotificationService],
})
export class NotificationModule {}
