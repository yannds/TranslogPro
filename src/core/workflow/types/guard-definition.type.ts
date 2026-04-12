import { WorkflowEntity } from '../interfaces/workflow-entity.interface';
import { TransitionInput } from '../interfaces/transition-input.interface';

/**
 * A guard returns `true` if the transition is allowed, or throws / returns
 * `false` with a reason to block it.
 */
export type GuardFn<E extends WorkflowEntity = WorkflowEntity> = (
  entity:  E,
  input:   TransitionInput,
  context: Record<string, unknown>,
) => Promise<boolean> | boolean;

export interface GuardDefinition<E extends WorkflowEntity = WorkflowEntity> {
  name: string;
  fn:   GuardFn<E>;
}
