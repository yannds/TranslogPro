import { Module, Global } from '@nestjs/common';
import { WorkflowEngine } from './workflow.engine';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [WorkflowEngine, AuditService],
  exports:   [WorkflowEngine, AuditService],
})
export class WorkflowModule {}
