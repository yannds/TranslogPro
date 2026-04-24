/**
 * BuiltInSideEffectsRegistrar — enregistre les handlers built-in au boot
 * de l'app (hook `onModuleInit`). Doit être instancié APRÈS `SideEffectRegistry`
 * dans l'arbre de dépendances Nest.
 *
 * Les modules métier qui fournissent leurs propres handlers suivent le même
 * pattern : créer un `XxxSideEffectsRegistrar` dans leur module qui appelle
 * `sideEffectRegistry.register(...)` au onModuleInit.
 */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { SideEffectRegistry } from '../side-effect.registry';
import { BUILT_IN_SIDE_EFFECTS } from './built-in-side-effects';

@Injectable()
export class BuiltInSideEffectsRegistrar implements OnModuleInit {
  private readonly logger = new Logger(BuiltInSideEffectsRegistrar.name);

  constructor(private readonly registry: SideEffectRegistry) {}

  onModuleInit() {
    for (const [name, fn] of Object.entries(BUILT_IN_SIDE_EFFECTS)) {
      this.registry.register(name, fn);
    }
    this.logger.log(
      `Built-in side-effect handlers registered (${Object.keys(BUILT_IN_SIDE_EFFECTS).length}) : ` +
      `${this.registry.list().join(', ')}`,
    );
  }
}
