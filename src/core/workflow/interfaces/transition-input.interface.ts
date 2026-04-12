import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';

/**
 * PRD §III.3 — Input d'une transition workflow.
 *
 * L'appelant passe un VERBE (`action`), pas un état cible.
 * Le moteur résout (fromState, action) → toState depuis WorkflowConfig en DB.
 * Le code métier ne connaît jamais le toState avant que le moteur ne l'ait validé.
 */
export interface TransitionInput {
  /** Verbe de transition ex: "BOARD", "DEPART", "CANCEL" */
  action:          string;
  /** Utilisateur authentifié déclenchant la transition */
  actor:           CurrentUserPayload;
  /** IP de la requête — pour l'audit trail ISO 27001 */
  ipAddress?:      string;
  /** Header Idempotency-Key — obligatoire sur les POST mutants */
  idempotencyKey?: string;
  /** Contexte additionnel passé aux guards et side-effects */
  context?:        Record<string, unknown>;
}
