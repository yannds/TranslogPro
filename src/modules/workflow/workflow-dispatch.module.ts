import { Module } from '@nestjs/common';
import { WorkflowDispatchService } from './workflow-dispatch.service';
import { WorkflowController } from './workflow.controller';

@Module({
  controllers: [WorkflowController],
  providers:   [WorkflowDispatchService],
  exports:     [WorkflowDispatchService],
})
export class WorkflowDispatchModule {}
