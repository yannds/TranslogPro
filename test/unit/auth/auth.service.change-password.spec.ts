/**
 * AuthService.changePassword — unit tests
 *
 * Vérifie :
 *   - currentPassword vérifié via bcrypt ; échec → 401
 *   - newPassword < 8 caractères → 400
 *   - newPassword identique à l'actuel → 400
 *   - Account credential manquant → 400 (compte OAuth uniquement)
 *   - User introuvable → 404
 *   - Succès : hash bcrypt.12, forcePasswordChange cleared, toutes sessions purgées
 *
 * Prisma entièrement mocké — pas de DB réelle.
 */
import * as bcrypt from 'bcryptjs';
import {
  BadRequestException, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../../../src/modules/auth/auth.service';

describe('AuthService.changePassword', () => {
  let prismaMock: any;
  let service:    AuthService;

  beforeEach(() => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        update:     jest.fn().mockResolvedValue({}),
      },
      account: {
        findFirst: jest.fn(),
        update:    jest.fn().mockResolvedValue({}),
      },
      session: {
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn().mockImplementation(async (ops: any[]) => Promise.all(ops)),
    };

    service = new AuthService(
      prismaMock,
      { listActiveKeys: jest.fn().mockResolvedValue([]) } as any,
      { verifyLoginCode: jest.fn() } as any,
      { findCredentialAccount: jest.fn(), upsertCredentialAccount: jest.fn() } as any,
    );
  });

  it('rejette un newPassword < 8 caractères (400)', async () => {
    await expect(
      service.changePassword('u1', 'oldPwd123!', 'short', '127.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejette un newPassword identique à l\'actuel (400)', async () => {
    await expect(
      service.changePassword('u1', 'samePwd123!', 'samePwd123!', '127.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throw NotFound si le user n\'existe pas', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      service.changePassword('unknown', 'oldPwd123!', 'newPwd456!', '127.0.0.1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throw BadRequest si pas de compte credential (OAuth-only)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', tenantId: 't1', email: 'a@b.c' });
    prismaMock.account.findFirst.mockResolvedValue(null);
    await expect(
      service.changePassword('u1', 'oldPwd123!', 'newPwd456!', '127.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throw Unauthorized si currentPassword ne matche pas', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', tenantId: 't1', email: 'a@b.c' });
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'a1',
      password: await bcrypt.hash('actualPwd', 10),
    });
    await expect(
      service.changePassword('u1', 'wrongPwd!', 'newPwd456!', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('succès : hash bcrypt + forcePasswordChange=false + toutes sessions purgées', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', tenantId: 't1', email: 'a@b.c' });
    prismaMock.account.findFirst.mockResolvedValue({
      id: 'a1',
      password: await bcrypt.hash('oldPwd123!', 10),
    });

    await service.changePassword('u1', 'oldPwd123!', 'newPwd456!', '10.0.0.1');

    // Transaction contient (a) update account (b) deleteMany session
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const [accountUpdateCall, sessionDeleteCall] = prismaMock.$transaction.mock.calls[0][0];
    // Les promesses sont déjà résolues — mais on peut vérifier que les mocks sous-jacents ont été appelés.
    expect(prismaMock.account.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a1' },
      data:  expect.objectContaining({
        forcePasswordChange: false,
        passwordResetTokenHash: null,
      }),
    }));
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });

    // Le password stocké est bien un hash bcrypt différent de 'oldPwd123!'
    const updatePayload = prismaMock.account.update.mock.calls[0][0];
    expect(updatePayload.data.password).not.toEqual('newPwd456!');
    expect(await bcrypt.compare('newPwd456!', updatePayload.data.password)).toBe(true);

    void accountUpdateCall; void sessionDeleteCall;
  });
});
