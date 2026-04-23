import { Module, Global } from '@nestjs/common';
import { WorkflowEngine } from './workflow.engine';
import { AuditService } from './audit.service';
import { SideEffectRegistry } from './side-effect.registry';

@Global()
@Module({
  providers: [WorkflowEngine, AuditService, SideEffectRegistry],
  exports:   [WorkflowEngine, AuditService, SideEffectRegistry],
})
export class WorkflowModule {}
