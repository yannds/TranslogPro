import { Module, Global } from '@nestjs/common';
import { WorkflowEngine } from './workflow.engine';
import { AuditService } from './audit.service';
import { SideEffectRegistry } from './side-effect.registry';
import { BuiltInSideEffectsRegistrar } from './handlers/built-in-side-effects.registrar';

@Global()
@Module({
  providers: [WorkflowEngine, AuditService, SideEffectRegistry, BuiltInSideEffectsRegistrar],
  exports:   [WorkflowEngine, AuditService, SideEffectRegistry],
})
export class WorkflowModule {}
