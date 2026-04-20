import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';
import { MaintenancePredictionService } from './maintenance-prediction.service';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [WorkflowModule],
  controllers: [GarageController],
  providers:   [GarageService, MaintenancePredictionService],
  exports:     [GarageService, MaintenancePredictionService],
})
export class GarageModule {}
