import { Module } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { ShipmentController } from './shipment.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [WorkflowModule],
  controllers: [ShipmentController],
  providers:   [ShipmentService],
  exports:     [ShipmentService],
})
export class ShipmentModule {}
