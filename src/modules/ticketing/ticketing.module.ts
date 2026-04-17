import { Module } from '@nestjs/common';
import { TicketingService } from './ticketing.service';
import { TicketingController } from './ticketing.controller';
import { QrService } from '../../core/security/qr/qr.service';
import { PricingModule } from '../../core/pricing/pricing.module';
import { SavModule } from '../sav/sav.module';

@Module({
  imports:     [PricingModule, SavModule],
  controllers: [TicketingController],
  providers:   [TicketingService, QrService],
  exports:     [TicketingService],
})
export class TicketingModule {}
