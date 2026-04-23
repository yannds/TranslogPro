import { Module } from '@nestjs/common';
import { TicketingService } from './ticketing.service';
import { TicketingController } from './ticketing.controller';
import { QrService } from '../../core/security/qr/qr.service';
import { PricingModule } from '../../core/pricing/pricing.module';
import { SavModule } from '../sav/sav.module';
import { CrmModule } from '../crm/crm.module';
import { CashierModule } from '../cashier/cashier.module';
import { InvoiceModule } from '../invoice/invoice.module';

@Module({
  imports:     [PricingModule, SavModule, CrmModule, CashierModule, InvoiceModule],
  controllers: [TicketingController],
  providers:   [TicketingService, QrService],
  exports:     [TicketingService],
})
export class TicketingModule {}
