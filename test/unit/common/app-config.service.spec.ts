import { AppConfigService } from '../../../src/common/config/app-config.service';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const backup = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
  try { return fn(); } finally {
    for (const k of Object.keys(env)) {
      if (backup[k] === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string>)[k] = backup[k]!;
    }
  }
}

describe('AppConfigService', () => {
  describe('NODE_ENV', () => {
    it('default à "development" si absent', () => {
      withEnv({ NODE_ENV: undefined }, () => {
        const c = new AppConfigService();
        expect(c.nodeEnv).toBe('development');
        expect(c.isDevelopment).toBe(true);
        expect(c.isProduction).toBe(false);
      });
    });

    it('reconnaît "production" → isProduction=true', () => {
      withEnv({ NODE_ENV: 'production' }, () => {
        const c = new AppConfigService();
        expect(c.isProduction).toBe(true);
        expect(c.isDevelopment).toBe(false);
        expect(c.isTest).toBe(false);
      });
    });

    it('reconnaît "test" → isTest=true', () => {
      withEnv({ NODE_ENV: 'test' }, () => {
        const c = new AppConfigService();
        expect(c.isTest).toBe(true);
      });
    });
  });

  describe('URLs publiques', () => {
    it('baseDomain fallback à translog.test en dev', () => {
      withEnv({ PUBLIC_BASE_DOMAIN: undefined, PLATFORM_BASE_DOMAIN: undefined }, () => {
        const c = new AppConfigService();
        expect(c.publicBaseDomain).toBe('translog.test');
      });
    });

    it('PUBLIC_BASE_DOMAIN gagne sur PLATFORM_BASE_DOMAIN', () => {
      withEnv({ PUBLIC_BASE_DOMAIN: 'primary.com', PLATFORM_BASE_DOMAIN: 'fallback.com' }, () => {
        expect(new AppConfigService().publicBaseDomain).toBe('primary.com');
      });
    });

    it('publicAppUrl dérive de baseDomain si non overridé', () => {
      withEnv({ PUBLIC_BASE_DOMAIN: 'xyz.com', PUBLIC_APP_URL: undefined }, () => {
        expect(new AppConfigService().publicAppUrl).toBe('https://admin.xyz.com');
      });
    });

    it('publicAppUrl retire le slash final', () => {
      withEnv({ PUBLIC_APP_URL: 'https://app.xyz.com/' }, () => {
        expect(new AppConfigService().publicAppUrl).toBe('https://app.xyz.com');
      });
    });
  });

  describe('feature flags booléens stricts', () => {
    it('activationEmailsEnabled : true uniquement si "true" (opt-in)', () => {
      withEnv({ ACTIVATION_EMAILS_ENABLED: 'true' }, () => {
        expect(new AppConfigService().activationEmailsEnabled).toBe(true);
      });
      withEnv({ ACTIVATION_EMAILS_ENABLED: '1' }, () => {
        expect(new AppConfigService().activationEmailsEnabled).toBe(false);
      });
      withEnv({ ACTIVATION_EMAILS_ENABLED: undefined }, () => {
        expect(new AppConfigService().activationEmailsEnabled).toBe(false);
      });
    });
  });

  describe('emailProvider', () => {
    it('défaut "console" en dev', () => {
      withEnv({ NODE_ENV: 'development', EMAIL_PROVIDER: undefined }, () => {
        expect(new AppConfigService().emailProvider).toBe('console');
      });
    });

    it('défaut "resend" en prod', () => {
      withEnv({ NODE_ENV: 'production', EMAIL_PROVIDER: undefined, PUBLIC_BASE_DOMAIN: 'x.com', PUBLIC_APP_URL: 'https://a.x.com' }, () => {
        expect(new AppConfigService().emailProvider).toBe('resend');
      });
    });

    it('override via EMAIL_PROVIDER', () => {
      withEnv({ EMAIL_PROVIDER: 'smtp' }, () => {
        expect(new AppConfigService().emailProvider).toBe('smtp');
      });
    });
  });

  describe('oauthLinkingStrategy', () => {
    it('strict par défaut', () => {
      withEnv({ OAUTH_LINKING_STRATEGY: undefined }, () => {
        expect(new AppConfigService().oauthLinkingStrategy).toBe('strict');
      });
    });
    it('flexible uniquement si exactement "flexible"', () => {
      withEnv({ OAUTH_LINKING_STRATEGY: 'flexible' }, () => {
        expect(new AppConfigService().oauthLinkingStrategy).toBe('flexible');
      });
      withEnv({ OAUTH_LINKING_STRATEGY: 'FLEXIBLE' }, () => {
        // sensible à la casse — sécurité par défaut
        expect(new AppConfigService().oauthLinkingStrategy).toBe('strict');
      });
    });
  });

  describe('getString / getBoolean / getNumber', () => {
    it('getString avec fallback', () => {
      withEnv({ MY_VAR: undefined }, () => {
        expect(new AppConfigService().getString('MY_VAR', 'default')).toBe('default');
      });
    });

    it('getString sans fallback → throw', () => {
      withEnv({ MY_VAR: undefined }, () => {
        expect(() => new AppConfigService().getString('MY_VAR')).toThrow(/required/);
      });
    });

    it('getBoolean strict : "true"→true, "false"→false, autre→fallback', () => {
      withEnv({ F: 'true'  }, () => expect(new AppConfigService().getBoolean('F', false)).toBe(true));
      withEnv({ F: 'false' }, () => expect(new AppConfigService().getBoolean('F', true)).toBe(false));
      withEnv({ F: 'yes'   }, () => expect(new AppConfigService().getBoolean('F', false)).toBe(false));
      withEnv({ F: undefined }, () => expect(new AppConfigService().getBoolean('F', true)).toBe(true));
    });

    it('getNumber throws si NaN', () => {
      withEnv({ N: 'abc' }, () => {
        expect(() => new AppConfigService().getNumber('N')).toThrow(/not a valid number/);
      });
    });

    it('getNumber avec fallback si absent', () => {
      withEnv({ N: undefined }, () => {
        expect(new AppConfigService().getNumber('N', 42)).toBe(42);
      });
    });
  });

  describe('platformBootstrapKey', () => {
    it('retourne undefined si absent (pas de fallback — sécurité)', () => {
      withEnv({ PLATFORM_BOOTSTRAP_KEY: undefined }, () => {
        expect(new AppConfigService().platformBootstrapKey).toBeUndefined();
      });
    });
  });
});
