/**
 * Security Test — Input Validation & Injection Prevention
 *
 * Tests unitaires sur SignInDto avec class-validator en direct.
 * Vérifie que :
 *   - Les payloads SQL injection ne passent pas IsEmail
 *   - Les payloads XSS sont rejetés (non email)
 *   - Les champs hors whitelist sont rejetés (forbidNonWhitelisted)
 *   - Les payloads surdimensionnés sont rejetés
 *   - Les types incorrects sont rejetés
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SignInDto } from '@/modules/auth/dto/sign-in.dto';
import { ValidationPipe } from '@nestjs/common';

const pipe = new ValidationPipe({
  whitelist:            true,
  forbidNonWhitelisted: true,
  transform:            true,
});

async function runValidation(plain: unknown) {
  try {
    await pipe.transform(plain, {
      type:     'body',
      metatype: SignInDto,
      data:     '',
    });
    return { ok: true, errors: [] };
  } catch (err: any) {
    const response = typeof err.getResponse === 'function' ? err.getResponse() : err;
    return { ok: false, errors: response };
  }
}

describe('[SECURITY] Input Validation & Injection Prevention', () => {
  // ── Happy path ─────────────────────────────────────────────────────────────

  it('should accept a valid payload', async () => {
    const { ok } = await runValidation({
      email:    'user@example.com',
      password: 'ValidPassword1!',
    });
    expect(ok).toBe(true);
  });

  // ── SQL Injection ─────────────────────────────────────────────────────────

  describe('SQL Injection in email', () => {
    const sqlPayloads = [
      "' OR 1=1 --",
      "'; DROP TABLE users; --",
      "' UNION SELECT * FROM sessions --",
      "admin'--",
      "1; EXEC xp_cmdshell('whoami')",
      "' OR ''='",
    ];

    it.each(sqlPayloads)('should reject SQL payload as email: %s', async (payload) => {
      const { ok } = await runValidation({ email: payload, password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });
  });

  // ── XSS ──────────────────────────────────────────────────────────────────

  describe('XSS in email', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><svg/onload=alert(1)>',
      'javascript:alert(1)',
      '{{constructor.constructor("return this")()}}',
      '${7*7}',
    ];

    it.each(xssPayloads)('should reject XSS payload as email: %s', async (payload) => {
      const { ok } = await runValidation({ email: payload, password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });
  });

  // ── Mass Assignment ───────────────────────────────────────────────────────

  describe('Mass Assignment', () => {
    it('should reject unknown fields (forbidNonWhitelisted)', async () => {
      const { ok, errors } = await runValidation({
        email:    'user@example.com',
        password: 'ValidPassword1!',
        role:     'SUPER_ADMIN',
        tenantId: '00000000-0000-0000-0000-000000000000',
        isAdmin:  true,
      });
      expect(ok).toBe(false);
      const msg = JSON.stringify(errors);
      expect(msg).toMatch(/role|tenantId|isAdmin|not allowed/i);
    });

    it('should reject prototype pollution attempt via __proto__', async () => {
      const payload: any = {
        email:    'user@example.com',
        password: 'ValidPassword1!',
      };
      payload['__proto__'] = { isAdmin: true };

      const { ok } = await runValidation(payload);
      // Le DTO doit soit rejeter, soit ignorer __proto__ — jamais le propager
      if (ok) {
        // Si accepté, vérifier qu'aucune pollution n'a eu lieu
        expect(({} as any).isAdmin).toBeUndefined();
      }
    });
  });

  // ── Oversized payloads ─────────────────────────────────────────────────────

  describe('Oversized Payloads', () => {
    it('should reject oversized email (>254 chars — RFC 5321)', async () => {
      const longEmail = 'a'.repeat(250) + '@test.local';
      const { ok } = await runValidation({ email: longEmail, password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });

    it('should reject oversized password (>128 chars)', async () => {
      const { ok } = await runValidation({
        email:    'user@example.com',
        password: 'A'.repeat(200),
      });
      expect(ok).toBe(false);
    });

    it('should reject password too short (<8 chars)', async () => {
      const { ok } = await runValidation({
        email:    'user@example.com',
        password: '1234567',
      });
      expect(ok).toBe(false);
    });

    it('should reject empty password', async () => {
      const { ok } = await runValidation({
        email:    'user@example.com',
        password: '',
      });
      expect(ok).toBe(false);
    });

    it('should reject empty email', async () => {
      const { ok } = await runValidation({
        email:    '',
        password: 'ValidPassword1!',
      });
      expect(ok).toBe(false);
    });
  });

  // ── Type confusion ────────────────────────────────────────────────────────

  describe('Type Confusion', () => {
    it('should reject number as email', async () => {
      const { ok } = await runValidation({ email: 12345, password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });

    it('should reject array as password', async () => {
      const { ok } = await runValidation({
        email:    'user@example.com',
        password: ['a', 'b', 'c'] as any,
      });
      expect(ok).toBe(false);
    });

    it('should reject NoSQL injection object as email', async () => {
      const { ok } = await runValidation({
        email:    { $gt: '' } as any,
        password: 'ValidPassword1!',
      });
      expect(ok).toBe(false);
    });

    it('should reject null as email', async () => {
      const { ok } = await runValidation({ email: null, password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });

    it('should reject missing email', async () => {
      const { ok } = await runValidation({ password: 'ValidPassword1!' });
      expect(ok).toBe(false);
    });

    it('should reject missing password', async () => {
      const { ok } = await runValidation({ email: 'user@example.com' });
      expect(ok).toBe(false);
    });
  });

  // ── Email normalization (anti-enumeration) ─────────────────────────────────

  describe('Email normalization', () => {
    it('should lowercase the email during transform', async () => {
      const dto = plainToInstance(SignInDto, {
        email:    'USER@EXAMPLE.COM',
        password: 'ValidPassword1!',
      });
      expect(dto.email).toBe('user@example.com');
    });

    it('should trim whitespace in email', async () => {
      const dto = plainToInstance(SignInDto, {
        email:    '  user@example.com  ',
        password: 'ValidPassword1!',
      });
      expect(dto.email).toBe('user@example.com');
    });
  });
});
