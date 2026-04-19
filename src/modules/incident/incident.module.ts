import { Module } from '@nestjs/common';
import { IncidentService } from './incident.service';
import { IncidentController } from './incident.controller';
import { WorkflowModule } from '../../core/workflow/workflow.module';

@Module({
  imports:     [WorkflowModule],
  controllers: [IncidentController],
  providers:   [IncidentService],
  exports:     [IncidentService],
})
export class IncidentModule {}
