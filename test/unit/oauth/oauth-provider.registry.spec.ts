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
    isConfigured: async () => opts.enabled,
    buildAuthorizeUrl: async () => `https://x/${opts.key}`,
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
  // Note contrat : depuis le refactor "UI grise les non-configurés", la registry
  // référence TOUS les providers déclarés. Le filtrage isConfigured() se fait
  // au moment d'initier un flow (buildAuthorizeUrl lève PROVIDER_ERROR si
  // les credentials Vault manquent).

  it('expose tous les providers déclarés (UI les grise si non configurés)', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',  enabled: false }),
      mkProvider({ key: 'microsoft', enabled: true }),
    ]);
    expect(reg.count()).toBe(2);
    expect(reg.get('google')).toBeDefined();
    expect(reg.get('microsoft')).toBeDefined();
  });

  it('list() retourne les métadonnées publiques pour chaque provider', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',   enabled: true,  displayName: 'Google' }),
      mkProvider({ key: 'facebook', enabled: false }),
      mkProvider({ key: 'microsoft', enabled: true, displayName: 'Microsoft' }),
    ]);
    const list = reg.list();
    expect(list).toHaveLength(3);
    expect(list.map(m => m.key).sort()).toEqual(['facebook', 'google', 'microsoft']);
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
    // Init depuis le constructor — pas besoin d'appeler onModuleInit.

    expect(reg.count()).toBe(1);
    expect(reg.get('google')?.meta.displayName).toBe('GoogleA');
  });

  it('registry conserve tous les providers même non configurés (filtrage à l\'appel)', () => {
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google',   enabled: false }),
      mkProvider({ key: 'microsoft', enabled: false }),
    ]);
    expect(reg.count()).toBe(2);
    expect(reg.list()).toHaveLength(2);
  });

  it('ajout d\'un nouveau provider — même forme IOAuthProvider, zéro autre changement', () => {
    // Simulation : on crée un provider "apple" from scratch et on l'injecte.
    const apple = mkProvider({ key: 'apple', enabled: true, displayName: 'Apple' });
    const reg = new OAuthProviderRegistry([
      mkProvider({ key: 'google', enabled: true }),
      apple, // Ajout trivial
    ]);
    // Init depuis le constructor — pas besoin d'appeler onModuleInit.

    expect(reg.get('apple')).toBe(apple);
    expect(reg.list().map(m => m.key).sort()).toEqual(['apple', 'google']);
  });
});
