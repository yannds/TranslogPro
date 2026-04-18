import { OAuthProviderRegistry } from '../../../src/modules/oauth/providers/oauth-provider.registry';
import type { IOAuthProvider, OAuthProviderMetadata, NormalizedOAuthProfile } from '../../../src/modules/oauth/types';

/**
 * Le registry est le CONTRAT d'abstraction du module OAuth : si ce test
 * casse, on a cassé le mécanisme qui permet d'ajouter/retirer des
 * providers sans toucher au code cœur. Il est donc critique.
 */

function mkProvider(opts: {
  key: string;
  enabled: boolean;
  displayName?: string;
}): IOAuthProvider {
  const meta: OAuthProviderMetadata = {
    key:         opts.key,
    displayName: opts.displayName ?? opts.key,
    scopes:      ['email'],
  };
  return {
    meta,
    get isEnabled() { return opts.enabled; },
    buildAuthorizeUrl: () => `https://x/${opts.key}`,
    exchangeCodeForProfile: async (): Promise<NormalizedOAuthProfile> => ({
      providerKey:        opts.key,
      providerAccountId:  'acc1',
      email:              null,
      emailVerified:      false,
      name:               null,
      avatarUrl:          null,
      locale:             null,
      raw:                {},
    }),
  };
}

describe('OAuthProviderRegistry', () => {
  it('ignore silencieusement un provider isEnabled=false', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',  enabled: false }),
      mkProvider({ key: 'microsoft', enabled: true }),
    ]);
    reg.onModuleInit();

    expect(reg.count()).toBe(1);
    expect(reg.get('google')).toBeUndefined();
    expect(reg.get('microsoft')).toBeDefined();
  });

  it('list() retourne uniquement les métadonnées des providers actifs', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',   enabled: true,  displayName: 'Google' }),
      mkProvider({ key: 'facebook', enabled: false }),
      mkProvider({ key: 'microsoft', enabled: true, displayName: 'Microsoft' }),
    ]);
    reg.onModuleInit();

    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map(m => m.key).sort()).toEqual(['google', 'microsoft']);
    // Pas de fuite d'infos sensibles — seuls les champs meta publiés
    for (const m of list) {
      expect(Object.keys(m).every(k => ['key', 'displayName', 'icon', 'scopes'].includes(k))).toBe(true);
    }
  });

  it('gère les doublons de clé (garde le premier enregistré)', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google', enabled: true, displayName: 'GoogleA' }),
      mkProvider({ key: 'google', enabled: true, displayName: 'GoogleB' }),
    ]);
    reg.onModuleInit();

    expect(reg.count()).toBe(1);
    expect(reg.get('google')?.meta.displayName).toBe('GoogleA');
  });

  it('registry vide quand tous les providers sont désactivés', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',   enabled: false }),
      mkProvider({ key: 'microsoft', enabled: false }),
    ]);
    reg.onModuleInit();
    expect(reg.count()).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it('ajout d\'un nouveau provider — même forme IOAuthProvider, zéro autre changement', () => {
    // Simulation : on crée un provider "apple" from scratch et on l'injecte.
    const apple = mkProvider({ key: 'apple', enabled: true, displayName: 'Apple' });
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google', enabled: true }),
      apple, // Ajout trivial
    ]);
    reg.onModuleInit();

    expect(reg.get('apple')).toBe(apple);
    expect(reg.list().map(m => m.key).sort()).toEqual(['apple', 'google']);
  });
});
