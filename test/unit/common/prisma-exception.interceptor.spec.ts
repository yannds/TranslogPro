/**
 * PrismaExceptionInterceptor — Tests unitaires ciblés sur le mapping des codes
 * Prisma vers HttpException. Focus sur le nouveau cas P2022 (drift schema).
 */

import { ConflictException, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { PrismaExceptionInterceptor } from '@common/interceptors/prisma-exception.interceptor';

function makeKnown(code: string, meta: Record<string, unknown> = {}): Prisma.PrismaClientKnownRequestError {
  const err = new Prisma.PrismaClientKnownRequestError(
    `Test error ${code}`,
    { code, clientVersion: '5.22.0', meta },
  );
  return err;
}

async function runInterceptor(error: unknown): Promise<unknown> {
  const interceptor = new PrismaExceptionInterceptor();
  const ctx = {} as any;
  const next = { handle: () => throwError(() => error) } as any;
  try {
    await lastValueFrom(interceptor.intercept(ctx, next));
    return null;
  } catch (caught) {
    return caught;
  }
}

describe('PrismaExceptionInterceptor', () => {
  afterEach(() => {
    delete (process.env as Record<string, string | undefined>)['NODE_ENV'];
  });

  describe('codes métier classiques', () => {
    it('P2002 → ConflictException (dev expose les champs)', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'development';
      const caught = await runInterceptor(makeKnown('P2002', { target: ['email'] }));
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as Error).message).toContain('email');
    });

    it('P2002 en prod → message générique (anti-énumération)', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'production';
      const caught = await runInterceptor(makeKnown('P2002', { target: ['email'] }));
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as Error).message).not.toContain('email');
    });

    it('P2003 (FK) → BadRequestException', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'development';
      const caught = await runInterceptor(makeKnown('P2003', { field_name: 'userId' }));
      expect(caught).toBeInstanceOf(BadRequestException);
    });

    it('P2025 (not found) → NotFoundException', async () => {
      const caught = await runInterceptor(makeKnown('P2025', { cause: 'Record does not exist' }));
      expect(caught).toBeInstanceOf(NotFoundException);
    });
  });

  describe('drift schema Prisma vs DB (P2021 / P2022)', () => {
    it('P2022 (colonne manquante) en dev → 500 avec message actionnable', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'development';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* noop */ });

      const caught = await runInterceptor(makeKnown('P2022', {
        table:  'tenant_business_configs',
        column: 'voucherFallbackOnRejectEnabled',
      }));

      expect(caught).toBeInstanceOf(InternalServerErrorException);
      expect((caught as Error).message).toContain('Drift schema');
      expect((caught as Error).message).toContain('voucherFallbackOnRejectEnabled');
      // Bannière console : contient les commandes de remédiation
      const banner = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(banner).toContain('db:check');
      expect(banner).toContain('db:sync');
      consoleSpy.mockRestore();
    });

    it('P2021 (table manquante) en dev → 500 avec référence à la table', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'development';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const caught = await runInterceptor(makeKnown('P2021', { table: 'ghost_table' }));
      expect(caught).toBeInstanceOf(InternalServerErrorException);
      expect((caught as Error).message).toContain('ghost_table');
      consoleSpy.mockRestore();
    });

    it('P2022 en prod → 500 générique (pas de leak de structure DB)', async () => {
      (process.env as Record<string, string>)['NODE_ENV'] = 'production';
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { /* noop */ });
      const caught = await runInterceptor(makeKnown('P2022', {
        table:  'secret_table',
        column: 'secret_column',
      }));
      expect(caught).toBeInstanceOf(InternalServerErrorException);
      expect((caught as Error).message).not.toContain('secret_table');
      expect((caught as Error).message).not.toContain('secret_column');
      // Pas de bannière en prod
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('non-Prisma errors', () => {
    it('laisse passer les erreurs non-Prisma (autre filtre les gère)', async () => {
      const original = new Error('not a prisma error');
      const caught = await runInterceptor(original);
      expect(caught).toBe(original);
    });

    it('succès → passe sans transformation', async () => {
      const interceptor = new PrismaExceptionInterceptor();
      const ctx = {} as any;
      const next = { handle: () => of({ ok: true }) } as any;
      const result = await lastValueFrom(interceptor.intercept(ctx, next));
      expect(result).toEqual({ ok: true });
    });
  });
});
