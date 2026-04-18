/**
 * HostConfigService — unit tests.
 *
 * Couvre :
 *   - Parsing env (default fallback translog.test)
 *   - extractSubdomain : apex, port stripping, wildcard, sous-domaines imbriqués
 *   - isAdminHost / isPlatformHost
 *   - buildTenantUrl / buildAdminUrl
 *   - isReservedSubdomain
 */

import { HostConfigService } from '../../../src/core/tenancy/host-config.service';

describe('HostConfigService', () => {
  let svc: HostConfigService;

  const withEnv = (env: Record<string, string | undefined>, fn: () => void): void => {
    const backup: Record<string, string | undefined> = {};
    for (const k of Object.keys(env)) {
      backup[k] = process.env[k];
      if (env[k] === undefined) delete process.env[k];
      else process.env[k] = env[k];
    }
    try { fn(); }
    finally {
      for (const k of Object.keys(backup)) {
        if (backup[k] === undefined) delete process.env[k];
        else process.env[k] = backup[k];
      }
    }
  };

  beforeEach(() => {
    withEnv(
      { PLATFORM_BASE_DOMAIN: 'translog.test', ADMIN_SUBDOMAIN: 'admin' },
      () => { svc = new HostConfigService(); },
    );
  });

  // ─── Defaults ──────────────────────────────────────────────────────────────

  it('charge les défauts translog.test / admin', () => {
    expect(svc.platformBaseDomain).toBe('translog.test');
    expect(svc.adminSubdomain).toBe('admin');
    expect(svc.protocol).toBe('https');
    expect(svc.reservedSubdomains).toEqual(expect.arrayContaining(['admin', 'api', 'www']));
  });

  it('respecte les env PLATFORM_BASE_DOMAIN et ADMIN_SUBDOMAIN', () => {
    withEnv(
      { PLATFORM_BASE_DOMAIN: 'TRANSLOGPRO.COM', ADMIN_SUBDOMAIN: 'SUPER' },
      () => {
        const prodSvc = new HostConfigService();
        expect(prodSvc.platformBaseDomain).toBe('translogpro.com');    // lowercased
        expect(prodSvc.adminSubdomain).toBe('super');
        expect(prodSvc.reservedSubdomains).toContain('super');          // auto-add
      },
    );
  });

  it('fusionne RESERVED_SUBDOMAINS depuis l\'env', () => {
    withEnv({ RESERVED_SUBDOMAINS: 'beta,canary' }, () => {
      const s = new HostConfigService();
      expect(s.reservedSubdomains).toEqual(expect.arrayContaining(['beta', 'canary', 'admin']));
    });
  });

  // ─── extractSubdomain ──────────────────────────────────────────────────────

  describe('extractSubdomain', () => {
    it('retourne null pour l\'apex domain', () => {
      expect(svc.extractSubdomain('translog.test')).toBeNull();
    });

    it('extrait un sous-domaine simple', () => {
      expect(svc.extractSubdomain('tenanta.translog.test')).toBe('tenanta');
    });

    it('strippe le port', () => {
      expect(svc.extractSubdomain('tenanta.translog.test:8443')).toBe('tenanta');
    });

    it('lowercase le host', () => {
      expect(svc.extractSubdomain('TENANTA.TRANSLOG.TEST')).toBe('tenanta');
    });

    it('retourne null pour un host externe', () => {
      expect(svc.extractSubdomain('evil.com')).toBeNull();
      expect(svc.extractSubdomain('tenanta.translogpro.com')).toBeNull();
    });

    it('accepte les sous-domaines imbriqués', () => {
      expect(svc.extractSubdomain('deep.sub.translog.test')).toBe('deep.sub');
    });

    it('retourne null pour hostname vide', () => {
      expect(svc.extractSubdomain('')).toBeNull();
    });

    it('retourne le sous-domaine admin', () => {
      expect(svc.extractSubdomain('admin.translog.test')).toBe('admin');
    });
  });

  // ─── isAdminHost / isPlatformHost ─────────────────────────────────────────

  describe('isAdminHost', () => {
    it('vrai pour le sous-domaine admin', () => {
      expect(svc.isAdminHost('admin.translog.test')).toBe(true);
      expect(svc.isAdminHost('admin.translog.test:443')).toBe(true);
    });

    it('faux pour un autre sous-domaine', () => {
      expect(svc.isAdminHost('tenanta.translog.test')).toBe(false);
      expect(svc.isAdminHost('translog.test')).toBe(false);
    });
  });

  describe('isPlatformHost', () => {
    it('vrai pour l\'apex et les sous-domaines plateforme', () => {
      expect(svc.isPlatformHost('translog.test')).toBe(true);
      expect(svc.isPlatformHost('tenanta.translog.test')).toBe(true);
      expect(svc.isPlatformHost('admin.translog.test:8443')).toBe(true);
    });

    it('faux pour les domaines externes', () => {
      expect(svc.isPlatformHost('evil.com')).toBe(false);
      expect(svc.isPlatformHost('translog.com')).toBe(false);   // typo → pas plateforme
    });
  });

  // ─── buildTenantUrl / buildAdminUrl ────────────────────────────────────────

  describe('buildTenantUrl', () => {
    it('construit une URL https scoped au sous-domaine', () => {
      expect(svc.buildTenantUrl('tenanta', '/auth/reset?token=abc'))
        .toBe('https://tenanta.translog.test/auth/reset?token=abc');
    });

    it('ajoute un / si path sans préfixe', () => {
      expect(svc.buildTenantUrl('tenanta', 'login')).toBe('https://tenanta.translog.test/login');
    });

    it('défaut path = /', () => {
      expect(svc.buildTenantUrl('tenanta')).toBe('https://tenanta.translog.test/');
    });

    it('lowercase le slug', () => {
      expect(svc.buildTenantUrl('TenantA', '/')).toBe('https://tenanta.translog.test/');
    });
  });

  describe('buildAdminUrl', () => {
    it('pointe sur le sous-domaine admin', () => {
      expect(svc.buildAdminUrl('/dashboard')).toBe('https://admin.translog.test/dashboard');
    });
  });

  // ─── isReservedSubdomain ──────────────────────────────────────────────────

  it('admin est toujours réservé', () => {
    expect(svc.isReservedSubdomain('admin')).toBe(true);
    expect(svc.isReservedSubdomain('ADMIN')).toBe(true);
  });

  it('api, www, mail sont réservés par défaut', () => {
    expect(svc.isReservedSubdomain('api')).toBe(true);
    expect(svc.isReservedSubdomain('www')).toBe(true);
    expect(svc.isReservedSubdomain('mail')).toBe(true);
  });

  it('un slug tenant lambda n\'est pas réservé', () => {
    expect(svc.isReservedSubdomain('tenanta')).toBe(false);
    expect(svc.isReservedSubdomain('compagnie-du-sud')).toBe(false);
  });
});
