/**
 * SideEffectRegistry — résolution déclarative des side-effects blueprint.
 *
 * ADR-15 / ADR-16 : le `WorkflowConfig.sideEffects: Json[]` en DB stocke des
 * NOMS de handlers (ex: `["createCashierTransaction", "restoreLinkedVoucher"]`).
 * Le moteur utilise ce registre pour convertir les noms en implémentations
 * exécutables. L'administrateur peut ainsi ajouter/retirer des side-effects
 * via `/admin/workflow-studio` sans toucher au code — à condition que le handler
 * nommé soit déjà enregistré ici.
 *
 * Pattern : registre injecté globalement dans WorkflowModule. Les services
 * peuvent enregistrer leurs handlers au boot (`onModuleInit`) ou statiquement.
 * L'engine résout les noms hors transaction (pur lookup mémoire).
 */
import { Injectable, Logger } from '@nestjs/common';
import { SideEffectDefinition, SideEffectFn } from './types/side-effect-definition.type';
import { WorkflowEntity } from './interfaces/workflow-entity.interface';

@Injectable()
export class SideEffectRegistry {
  private readonly logger = new Logger(SideEffectRegistry.name);
  private readonly handlers = new Map<string, SideEffectFn<WorkflowEntity>>();

  /**
   * Enregistre un handler nommé. Écrasement silencieux autorisé pour permettre
   * aux tests de remplacer les handlers live par des mocks.
   */
  register<E extends WorkflowEntity>(name: string, fn: SideEffectFn<E>): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`SideEffect handler "${name}" already registered — overwriting`);
    }
    this.handlers.set(name, fn as SideEffectFn<WorkflowEntity>);
  }

  /**
   * Résout une liste de noms (issus de `WorkflowConfig.sideEffects`) en
   * définitions exécutables. Les noms inconnus sont loggés mais n'interrompent
   * pas la transition — un blueprint peut référencer un handler non encore
   * câblé (pendant migration progressive).
   */
  resolve<E extends WorkflowEntity>(names: string[]): SideEffectDefinition<E>[] {
    const defs: SideEffectDefinition<E>[] = [];
    for (const name of names) {
      const fn = this.handlers.get(name);
      if (!fn) {
        this.logger.warn(`SideEffect handler "${name}" introuvable — ignoré (blueprint / registry déphasés)`);
        continue;
      }
      defs.push({ name, fn: fn as SideEffectFn<E> });
    }
    return defs;
  }

  /** Liste tous les handlers enregistrés (debug + UI workflow studio). */
  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }
}
