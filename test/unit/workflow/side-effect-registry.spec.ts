/**
 * SideEffectRegistry — tests unit.
 *
 * Garantit :
 *   - register()  : ajoute un handler nommé, overwrite autorisé (cas test)
 *   - resolve()   : convertit noms → définitions, ignore les inconnus
 *   - list()/has(): introspection pour UI Workflow Studio
 */
import { SideEffectRegistry } from '../../../src/core/workflow/side-effect.registry';

describe('SideEffectRegistry', () => {
  let registry: SideEffectRegistry;

  beforeEach(() => {
    registry = new SideEffectRegistry();
  });

  describe('register', () => {
    it('enregistre un handler nommé', () => {
      registry.register('notifyPassenger', async () => {});
      expect(registry.has('notifyPassenger')).toBe(true);
      expect(registry.list()).toContain('notifyPassenger');
    });

    it('autorise l\'overwrite (utile pour mock en test)', () => {
      const original = jest.fn();
      const override = jest.fn();
      registry.register('handler', original);
      registry.register('handler', override);
      const [def] = registry.resolve(['handler']);
      expect(def.fn).toBe(override);
    });
  });

  describe('resolve', () => {
    it('résout les noms connus en SideEffectDefinition', () => {
      const fn1 = async () => {};
      const fn2 = async () => {};
      registry.register('a', fn1);
      registry.register('b', fn2);

      const defs = registry.resolve(['a', 'b']);
      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe('a');
      expect(defs[0].fn).toBe(fn1);
      expect(defs[1].name).toBe('b');
      expect(defs[1].fn).toBe(fn2);
    });

    it('ignore silencieusement les noms inconnus (blueprint avancé vs code en retard)', () => {
      registry.register('known', async () => {});
      const defs = registry.resolve(['known', 'unknownHandler', 'another']);
      expect(defs).toHaveLength(1);
      expect(defs[0].name).toBe('known');
    });

    it('retourne liste vide pour input vide', () => {
      expect(registry.resolve([])).toEqual([]);
    });
  });

  describe('list + has', () => {
    it('list() retourne les handlers triés', () => {
      registry.register('zebra', async () => {});
      registry.register('alpha', async () => {});
      registry.register('omega', async () => {});
      expect(registry.list()).toEqual(['alpha', 'omega', 'zebra']);
    });

    it('has() retourne false pour handler non enregistré', () => {
      expect(registry.has('missing')).toBe(false);
    });
  });
});
