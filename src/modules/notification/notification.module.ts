import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

/**
 * NotificationModule — consomme ISmsService et IWhatsappService
 * fournis globalement par NotificationProviderModule (app.module.ts).
 */
@Module({
  controllers: [NotificationController],
  providers:   [NotificationService],
  exports:     [NotificationService],
})
export class NotificationModule {}
