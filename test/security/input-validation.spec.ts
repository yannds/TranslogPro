/**
 * Security Test — Input Validation & Injection
 *
 * Vérifie que les DTOs et le ValidationPipe rejettent :
 *   - Les payloads SQL injection
 *   - Les payloads XSS
 *   - Les champs non whitelistés (mass assignment)
 *   - Les payloads surdimensionnés
 *   - Les types incorrects
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import cookieParser from 'cookie-parser';

describe('[SECURITY] Input Validation & Injection Prevention', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
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

  // ── SQL Injection via sign-in ──────────────────────────────────────────────

  describe('SQL Injection', () => {
    const sqlPayloads = [
      "' OR 1=1 --",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM sessions --",
      "admin'--",
      "1; EXEC xp_cmdshell('whoami')",
      "' OR ''='",
    ];

    it.each(sqlPayloads)(
      'should reject SQL injection in email field: %s',
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in')
          .send({ email: payload, password: 'SomePassword1!' });

        // Doit retourner 400 (validation) ou 401 (auth failed), jamais 500
        expect(res.status).toBeLessThan(500);
        expect([400, 401]).toContain(res.status);
      },
    );

    it.each(sqlPayloads)(
      'should reject SQL injection in password field: %s',
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in')
          .send({ email: 'test@test.local', password: payload });

        expect(res.status).toBeLessThan(500);
      },
    );
  });

  // ── XSS Injection ─────────────────────────────────────────────────────────

  describe('XSS Injection', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg/onload=alert(1)>',
      "javascript:alert('xss')",
      '<iframe src="javascript:alert(1)">',
      '{{constructor.constructor("return this")()}}',
      '${7*7}',
    ];

    it.each(xssPayloads)(
      'should not reflect XSS payload in error response: %s',
      async (payload) => {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in')
          .send({ email: payload, password: 'SomePassword1!' });

        const body = JSON.stringify(res.body);
        // Le payload ne doit jamais être reflété tel quel dans la réponse
        expect(body).not.toContain('<script>');
        expect(body).not.toContain('onerror=');
        expect(body).not.toContain('onload=');
        expect(body).not.toContain('javascript:');
      },
    );
  });

  // ── Mass Assignment (champs non whitelistés) ───────────────────────────────

  describe('Mass Assignment', () => {
    it('should reject unknown fields in sign-in payload (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({
          email: 'test@test.local',
          password: 'ValidPassword1!',
          role: 'SUPER_ADMIN',        // tentative d'injection de rôle
          tenantId: '00000000-0000-0000-0000-000000000000',
          isAdmin: true,
        });

      // Doit retourner 400 (propriétés non autorisées), pas 200/401
      expect(res.status).toBe(400);
    });
  });

  // ── Payload surdimensionné ─────────────────────────────────────────────────

  describe('Oversized Payloads', () => {
    it('should reject oversized email (>254 chars — RFC 5321)', async () => {
      const longEmail = 'a'.repeat(250) + '@test.local';
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: longEmail, password: 'ValidPassword1!' });

      expect(res.status).toBe(400);
    });

    it('should reject oversized password (>128 chars)', async () => {
      const longPassword = 'A'.repeat(200);
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: 'test@test.local', password: longPassword });

      expect(res.status).toBe(400);
    });

    it('should reject password too short (<8 chars)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: 'test@test.local', password: '1234567' });

      expect(res.status).toBe(400);
    });
  });

  // ── Type confusion ────────────────────────────────────────────────────────

  describe('Type Confusion', () => {
    it('should reject non-string email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: 12345, password: 'ValidPassword1!' });

      expect(res.status).toBe(400);
    });

    it('should reject array as password', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: 'test@test.local', password: ['a', 'b', 'c'] });

      expect(res.status).toBe(400);
    });

    it('should reject object as email', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email: { $gt: '' }, password: 'ValidPassword1!' });

      expect(res.status).toBe(400);
    });

    it('should reject null body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send(null);

      expect(res.status).toBe(400);
    });
  });
});
