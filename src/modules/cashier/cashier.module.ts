import { Module } from '@nestjs/common';
import { CashierService } from './cashier.service';
import { CashierController } from './cashier.controller';

@Module({
  controllers: [CashierController],
  providers:   [CashierService],
  exports:     [CashierService],
})
export class CashierModule {}
