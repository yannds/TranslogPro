/**
 * Built-in side-effect handlers.
 *
 * Enregistrés automatiquement dans le `SideEffectRegistry` au démarrage
 * via `BuiltInSideEffectsRegistrar.onModuleInit()`. Un blueprint peut y
 * référencer n'importe lequel via son nom dans `WorkflowConfig.sideEffects`.
 *
 * Convention de nommage : verbe-Objet en camelCase (ex: `logTransition`).
 * Contrat : signatures parameterless pour le moment — les params par blueprint
 * arriveront dans une itération suivante (extension `SideEffectSpec`).
 *
 * Garanties :
 *   - Synchrones dans la transaction workflow → échec = rollback de la transition
 *   - Aucun I/O externe (HTTP, gRPC) → réservés à l'Outbox ou à un worker
 *   - Idempotents (rejouables sans effet de bord)
 */
import { Logger } from '@nestjs/common';
import { SideEffectFn } from '../types/side-effect-definition.type';
import { WorkflowEntity } from '../interfaces/workflow-entity.interface';

const logger = new Logger('SideEffectHandlers');

/**
 * `logTransition` — trace structurée pour SIEM / debug.
 * Utile pour les transitions sensibles où on veut un log supplémentaire
 * au-delà du log engine standard.
 */
export const logTransition: SideEffectFn<WorkflowEntity> = async (entity, input, context) => {
  logger.log(
    JSON.stringify({
      ev:       'workflow.transition.sideEffect.logTransition',
      entity:   entity.id,
      tenant:   entity.tenantId,
      status:   entity.status,
      action:   input.action,
      actor:    input.actor.id,
      context:  Object.keys(context ?? {}),
    }),
  );
};

/**
 * `noop` — handler vide explicite. Utile pour documenter qu'un blueprint
 * "pourrait" déclencher un side-effect sans le câbler immédiatement.
 */
export const noop: SideEffectFn<WorkflowEntity> = async () => {
  // intentionnellement vide
};

/**
 * `assertTenantScope` — défense en profondeur : vérifie que `entity.tenantId`
 * matche `input.actor.tenantId` avant de laisser passer la transition.
 * Utile sur les transitions particulièrement sensibles (transferts, refunds
 * haute valeur). En pratique le RLS + PermissionGuard filtrent déjà, mais
 * cet assert capture les chemins où les deux seraient contournés.
 */
export const assertTenantScope: SideEffectFn<WorkflowEntity> = async (entity, input) => {
  if (input.actor.id === 'SYSTEM') return; // acteurs système cross-tenant autorisés (scheduler, bulk)
  if (input.actor.tenantId !== entity.tenantId) {
    throw new Error(
      `assertTenantScope violated: actor tenant=${input.actor.tenantId} ` +
      `entity tenant=${entity.tenantId} entity=${entity.id}`,
    );
  }
};

/**
 * Map des handlers built-in par nom. Fixé — la registration runtime se fait
 * via `BuiltInSideEffectsRegistrar`. Toute nouvelle entrée ici nécessite
 * de re-générer la doc Workflow Studio (`/admin/workflow-studio/handlers`).
 */
export const BUILT_IN_SIDE_EFFECTS: Record<string, SideEffectFn<WorkflowEntity>> = {
  logTransition,
  noop,
  assertTenantScope,
};
