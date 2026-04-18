/**
 * Security Test — HTTP Headers & CORS
 *
 * Tests isolés sur une mini-app Express avec la même config Helmet
 * que main.ts. Vérifie :
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options
 *   - X-Powered-By retiré
 *   - CORS en dev (localhost:5173, localhost:5174)
 *   - CORS en prod (désactivé — proxy Kong)
 */
import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import request from 'supertest';

function createApp(nodeEnv: 'development' | 'production'): Express {
  const app = express();

  // Même config que main.ts
  app.use(helmet({
    contentSecurityPolicy: nodeEnv === 'production',
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({
    origin: nodeEnv === 'development'
      ? ['http://localhost:5173', 'http://localhost:5174']
      : false,
    credentials: true,
  }));

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

describe('[SECURITY] HTTP Headers & CORS', () => {
  // ── Helmet headers in dev ──────────────────────────────────────────────────

  describe('Helmet security headers (dev)', () => {
    let app: Express;
    beforeAll(() => { app = createApp('development'); });

    it('should set X-Content-Type-Options: nosniff', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-DNS-Prefetch-Control: off', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('should set X-Download-Options: noopen', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-download-options']).toBe('noopen');
    });

    it('should set X-Frame-Options: SAMEORIGIN (anti-clickjacking)', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('should NOT expose X-Powered-By header', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('should set Strict-Transport-Security header', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['strict-transport-security']).toBeDefined();
    });

    it('should NOT leak framework name in headers', async () => {
      const res = await request(app).get('/health/live');
      const allHeaders = JSON.stringify(res.headers).toLowerCase();
      expect(allHeaders).not.toContain('express');
      expect(allHeaders).not.toContain('nestjs');
    });
  });

  // ── CSP enforced in production ─────────────────────────────────────────────

  describe('CSP header (production)', () => {
    it('should set Content-Security-Policy in production', async () => {
      const app = createApp('production');
      const res = await request(app).get('/health/live');
      expect(res.headers['content-security-policy']).toBeDefined();
    });

    it('should NOT set CSP in development (Vite HMR compatibility)', async () => {
      const app = createApp('development');
      const res = await request(app).get('/health/live');
      expect(res.headers['content-security-policy']).toBeUndefined();
    });
  });

  // ── CORS ──────────────────────────────────────────────────────────────────

  describe('CORS policy', () => {
    it('should accept localhost:5173 in dev', async () => {
      const app = createApp('development');
      const res = await request(app)
        .options('/health/live')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should reject unauthorized origin in dev', async () => {
      const app = createApp('development');
      const res = await request(app)
        .options('/health/live')
        .set('Origin', 'https://evil.example.com')
        .set('Access-Control-Request-Method', 'GET');

      const acao = res.headers['access-control-allow-origin'];
      expect(acao).not.toBe('https://evil.example.com');
      expect(acao).not.toBe('*');
    });

    it('should disable CORS entirely in production (proxied by Kong)', async () => {
      const app = createApp('production');
      const res = await request(app)
        .options('/health/live')
        .set('Origin', 'https://app.translogpro.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // ── Health endpoints ──────────────────────────────────────────────────────

  describe('Health endpoints', () => {
    it('should expose /health/live without authentication', async () => {
      const app = createApp('development');
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('should not leak internal state in health response', async () => {
      const app = createApp('development');
      const res = await request(app).get('/health/live');
      const keys = Object.keys(res.body);
      expect(keys).toEqual(['status']);
    });
  });
});
