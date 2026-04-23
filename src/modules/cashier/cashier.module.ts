import { Module } from '@nestjs/common';
import { CashierService } from './cashier.service';
import { CashierController } from './cashier.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';

// PaymentProviderRegistry est injecté via PaymentModule marqué @Global().
// Pas besoin d'import explicite ici ; cela créerait un chemin de résolution
// redondant qui a cassé la DI quand activé (RefundService → CashierService
// indisponible dans SavModule context malgré l'import correct).
@Module({
  imports:     [WorkflowModule],
  controllers: [CashierController],
  providers:   [CashierService],
  exports:     [CashierService],
})
export class CashierModule {}
