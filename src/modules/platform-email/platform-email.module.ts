import { Module } from '@nestjs/common';
import { PlatformEmailController } from './platform-email.controller';
import { PlatformEmailService } from './platform-email.service';

/**
 * PlatformEmailModule — exposition admin plateforme des 4 providers email.
 *
 * Les 4 classes concrètes (ConsoleEmailService, SmtpEmailService,
 * ResendEmailService, O365EmailService) sont exportées par
 * NotificationProviderModule (@Global) et donc injectables ici sans import.
 */
@Module({
  controllers: [PlatformEmailController],
  providers:   [PlatformEmailService],
})
export class PlatformEmailModule {}
