import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { LifecycleNotificationListener } from './lifecycle-notification.listener';
import { InvoiceNotificationListener }   from './invoice-notification.listener';
import { InvoiceOverdueScheduler }       from './invoice-overdue.scheduler';
import { VoucherNotificationListener }   from './voucher-notification.listener';
import { RefundNotificationListener }    from './refund-notification.listener';
import { UserNotificationListener }      from './user-notification.listener';
import { TripCancelledNotificationListener } from './trip-cancelled-notification.listener';

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
 *   - VoucherNotificationListener   : 1 event bon d'avoir (voucher.issued) —
 *     Tier 1.2 chantier email 2026-04-26.
 *   - RefundNotificationListener    : 4 events refund (created/approved/
 *     auto_approved/rejected) — 3 templates (approved et auto_approved
 *     partagent le même) — Tier 1.3 chantier email 2026-04-26.
 *   - UserNotificationListener      : 1 event invitation user par admin
 *     (USER_INVITED) — EMAIL only — Tier 1.4 chantier email 2026-04-26.
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
    VoucherNotificationListener,
    RefundNotificationListener,
    UserNotificationListener,
    TripCancelledNotificationListener,
  ],
  exports:     [NotificationService],
})
export class NotificationModule {}
