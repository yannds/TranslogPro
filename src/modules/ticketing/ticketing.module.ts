import { Module } from '@nestjs/common';
import { TicketingService } from './ticketing.service';
import { TicketingController } from './ticketing.controller';
import { QrService } from '../../core/security/qr/qr.service';
import { PricingModule } from '../../core/pricing/pricing.module';

@Module({
  imports:     [PricingModule],
  controllers: [TicketingController],
  providers:   [TicketingService, QrService],
  exports:     [TicketingService],
})
export class TicketingModule {}
