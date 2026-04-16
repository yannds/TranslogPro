/**
 * Security Test — Auth Brute Force & Rate Limiting
 *
 * Vérifie que le rate limiting sur /api/auth/sign-in bloque
 * les tentatives massives (5 max / 15 min par IP).
 * Vérifie la réponse anti-énumération d'emails (timing-safe).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';
import cookieParser from 'cookie-parser';

describe('[SECURITY] Auth Brute Force & Rate Limiting', () => {
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

  // ── Rate Limiting ──────────────────────────────────────────────────────────

  it('should return 429 after exceeding rate limit (5 attempts)', async () => {
    const payload = { email: 'bruteforce@test.local', password: 'WrongPassword1!' };

    // Envoyer 6 requêtes — la 6ème doit être bloquée
    const responses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send(payload);
      responses.push(res.status);
    }

    // Au moins une réponse 429 dans les dernières
    const has429 = responses.some(s => s === 429);
    expect(has429).toBe(true);
  });

  // ── Timing-safe email enumeration ──────────────────────────────────────────

  it('should have similar response times for existing vs non-existing emails', async () => {
    const existingEmail = 'admin@translogpro.test';
    const fakeEmail     = 'nonexistent-user-xyz@nobody.local';
    const password      = 'WrongPassword1!';

    const measure = async (email: string): Promise<number> => {
      const start = process.hrtime.bigint();
      await request(app.getHttpServer())
        .post('/api/auth/sign-in')
        .send({ email, password });
      return Number(process.hrtime.bigint() - start) / 1e6; // ms
    };

    // Warm up
    await measure(existingEmail);
    await measure(fakeEmail);

    // Mesure réelle (moyenne de 3 runs)
    const timesExisting: number[] = [];
    const timesFake: number[] = [];
    for (let i = 0; i < 3; i++) {
      timesExisting.push(await measure(existingEmail));
      timesFake.push(await measure(fakeEmail));
    }

    const avgExisting = timesExisting.reduce((a, b) => a + b, 0) / timesExisting.length;
    const avgFake     = timesFake.reduce((a, b) => a + b, 0) / timesFake.length;

    // La différence ne doit pas dépasser 150ms (bcrypt domine le temps)
    const diff = Math.abs(avgExisting - avgFake);
    expect(diff).toBeLessThan(150);
  });

  // ── Generic error message (no email leak) ──────────────────────────────────

  it('should return generic error message on failed login (no email enumeration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in')
      .send({ email: 'nonexistent@test.local', password: 'SomePassword1!' });

    expect(res.status).toBe(401);
    // Le message ne doit PAS révéler si c'est l'email ou le mot de passe qui est faux
    expect(res.body.message).not.toMatch(/email/i);
    expect(res.body.message).not.toMatch(/not found/i);
    expect(res.body.message).not.toMatch(/unknown/i);
  });
});
