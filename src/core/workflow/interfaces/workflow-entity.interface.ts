/**
 * Any entity managed by the Workflow Engine must implement this interface.
 * The `version` field enables optimistic locking.
 */
export interface WorkflowEntity {
  id:       string;
  status:   string;
  tenantId: string;
  version:  number;
}
