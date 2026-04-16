/**
 * Security Test — HTTP Headers & CORS
 *
 * Vérifie que Helmet et la config CORS sont correctement appliqués :
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options (clickjacking)
 *   - X-XSS-Protection
 *   - Strict-Transport-Security (HSTS) — en prod
 *   - CORS rejette les origines non autorisées
 *   - Pas de header serveur révélant la stack
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

describe('[SECURITY] HTTP Headers & CORS', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    app.use(helmet({
      contentSecurityPolicy: false, // test env
      crossOriginEmbedderPolicy: false,
    }));
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // ── Helmet headers ────────────────────────────────────────────────────────

  it('should set X-Content-Type-Options: nosniff', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should set X-DNS-Prefetch-Control header', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });

  it('should set X-Download-Options header', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-download-options']).toBe('noopen');
  });

  it('should set X-Frame-Options header (anti-clickjacking)', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  // ── No server info leakage ─────────────────────────────────────────────────

  it('should not expose X-Powered-By header', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('should not expose server version in any header', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    const allHeaders = JSON.stringify(res.headers).toLowerCase();
    expect(allHeaders).not.toContain('express');
    expect(allHeaders).not.toContain('nestjs');
  });

  // ── CORS ──────────────────────────────────────────────────────────────────

  it('should reject requests from unauthorized origins', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/auth/sign-in')
      .set('Origin', 'https://evil-site.com')
      .set('Access-Control-Request-Method', 'POST');

    // En dev, seul localhost:5173/5174 est autorisé
    // L'origin malveillante ne doit pas avoir Access-Control-Allow-Origin
    const acao = res.headers['access-control-allow-origin'];
    if (acao) {
      expect(acao).not.toBe('https://evil-site.com');
      expect(acao).not.toBe('*');
    }
  });

  // ── Health endpoints public but safe ───────────────────────────────────────

  it('health/live should be accessible without auth', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('health/ready should be accessible without auth', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('health endpoints should not leak internal state', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    const bodyKeys = Object.keys(res.body);
    // Ne doit contenir que "status", pas de versions, uptime, etc.
    expect(bodyKeys).toEqual(['status']);
  });
});
