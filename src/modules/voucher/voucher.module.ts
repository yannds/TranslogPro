import { Module } from '@nestjs/common';
import { VoucherService } from './voucher.service';
import { VoucherController } from './voucher.controller';
import { CashierModule } from '../cashier/cashier.module';

@Module({
  imports:     [CashierModule],
  providers:   [VoucherService],
  controllers: [VoucherController],
  exports:     [VoucherService],
})
export class VoucherModule {}
