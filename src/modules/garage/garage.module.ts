import { Module } from '@nestjs/common';
import { GarageService } from './garage.service';
import { GarageController } from './garage.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [WorkflowModule],
  controllers: [GarageController],
  providers:   [GarageService],
  exports:     [GarageService],
})
export class GarageModule {}
