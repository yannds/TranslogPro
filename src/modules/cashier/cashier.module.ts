import { Module } from '@nestjs/common';
import { CashierService } from './cashier.service';
import { CashierController } from './cashier.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';
import { PaymentModule } from '../../infrastructure/payment/payment.module';

@Module({
  imports:     [WorkflowModule, PaymentModule],
  controllers: [CashierController],
  providers:   [CashierService],
  exports:     [CashierService],
})
export class CashierModule {}
