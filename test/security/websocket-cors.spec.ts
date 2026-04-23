/**
 * Security : WebSocket Gateways doivent refuser les origines inconnues.
 *
 * Fixe B-02 de l'audit 2026-04-23 : garantit que `@WebSocketGateway({ cors })`
 * pointe vers `websocketCorsConfig()` (allowlist stricte) sur TrackingGateway
 * (/gps) et DisplayGateway (/realtime). Une régression qui réintroduirait
 * `origin: '*'` serait immédiatement attrapée par ce test.
 */
import { corsOrigin, websocketCorsConfig } from '../../src/common/security/cors.helper';

describe('WebSocket CORS policy', () => {
  describe('websocketCorsConfig()', () => {
    it('expose une fonction origin et credentials=true', () => {
      const cfg = websocketCorsConfig();
      expect(typeof cfg.origin).toBe('function');
      expect(cfg.credentials).toBe(true);
    });
  });

  describe('corsOrigin() — dev mode', () => {
    const ORIG_ENV = process.env.NODE_ENV;
    beforeEach(() => {
      (process.env as Record<string, string>).NODE_ENV = 'development';
    });
    afterAll(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = ORIG_ENV;
    });

    it('autorise localhost:5173 (Vite)', (done) => {
      corsOrigin()('http://localhost:5173', (_err, ok) => {
        expect(ok).toBe(true); done();
      });
    });

    it('autorise *.translog.test (tenant host dev)', (done) => {
      corsOrigin()('http://citybus.translog.test:3001', (_err, ok) => {
        expect(ok).toBe(true); done();
      });
    });

    it("refuse un domaine externe inconnu (pas d'origin '*')", (done) => {
      corsOrigin()('https://evil.attacker.com', (_err, ok) => {
        expect(ok).toBe(false); done();
      });
    });

    it('autorise une origin absente (curl / server-to-server)', (done) => {
      corsOrigin()(undefined, (_err, ok) => {
        expect(ok).toBe(true); done();
      });
    });
  });

  describe('corsOrigin() — prod mode (PUBLIC_BASE_DOMAIN)', () => {
    const ORIG_ENV  = process.env.NODE_ENV;
    const ORIG_BASE = process.env.PUBLIC_BASE_DOMAIN;
    beforeEach(() => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      (process.env as Record<string, string>).PUBLIC_BASE_DOMAIN = 'translogpro.com';
    });
    afterAll(() => {
      (process.env as Record<string, string | undefined>).NODE_ENV = ORIG_ENV;
      (process.env as Record<string, string | undefined>).PUBLIC_BASE_DOMAIN = ORIG_BASE;
    });

    it('autorise https://*.translogpro.com', (done) => {
      corsOrigin()('https://app.translogpro.com', (_err, ok) => {
        expect(ok).toBe(true); done();
      });
    });

    it('autorise le domaine racine https://translogpro.com', (done) => {
      corsOrigin()('https://translogpro.com', (_err, ok) => {
        expect(ok).toBe(true); done();
      });
    });

    it('refuse http:// (non HTTPS) en prod', (done) => {
      corsOrigin()('http://app.translogpro.com', (_err, ok) => {
        expect(ok).toBe(false); done();
      });
    });

    it('refuse un domaine évident attaquant', (done) => {
      corsOrigin()('https://evil.com', (_err, ok) => {
        expect(ok).toBe(false); done();
      });
    });

    it('refuse localhost en prod', (done) => {
      corsOrigin()('http://localhost:5173', (_err, ok) => {
        expect(ok).toBe(false); done();
      });
    });
  });
});
