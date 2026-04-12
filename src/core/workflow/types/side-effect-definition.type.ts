import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';

/**
 * A side effect runs after a successful transition (within the same
 * transaction when a tx client is provided).
 */
export type SideEffectFn<E extends WorkflowEntity = WorkflowEntity> = (
  entity:   E,
  input:    TransitionInput,
  context:  Record<string, unknown>,
) => Promise<void>;

export interface SideEffectDefinition<E extends WorkflowEntity = WorkflowEntity> {
  name: string;
  fn:   SideEffectFn<E>;
}
