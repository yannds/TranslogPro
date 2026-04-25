import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { LifecycleNotificationListener } from './lifecycle-notification.listener';

/**
 * NotificationModule — consomme ISmsService et IWhatsappService fournis
 * globalement par NotificationProviderModule (app.module.ts) ; PrismaService
 * et PlatformConfigService sont aussi @Global, pas besoin d'imports ici.
 *
 * LifecycleNotificationListener s'abonne au bus d'événements (Outbox) pour
 * fan-out multi-canal sur les 5 évènements voyageur (achat, ouverture trajet,
 * embarquement, rappels, arrivée).
 */
@Module({
  controllers: [NotificationController],
  providers:   [NotificationService, LifecycleNotificationListener],
  exports:     [NotificationService],
})
export class NotificationModule {}
