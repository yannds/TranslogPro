import { PasswordResetService } from '../../../src/modules/password-reset/password-reset.service';

/**
 * Test unit — cooldown email password-reset (2026-04-20).
 *
 * initiateBySelf doit skip silencieusement si un token a déjà été émis pour
 * cet email dans la dernière heure. Empêche un attaquant (même via rotation
 * d'IP) de flooder un email tiers avec des mails de reset.
 */
describe('PasswordResetService.initiateBySelf — email cooldown', () => {
  function makeService(opts: { recentToken: boolean; accountActive?: boolean }) {
    const RESET_TTL_MS = 30 * 60 * 1_000;
    const recentIssuedAt = Date.now() - 30 * 60_000; // issued 30 min ago
    const recentExpiresAt = new Date(recentIssuedAt + RESET_TTL_MS);

    const identity: any = {
      findCredentialAccount: jest.fn().mockResolvedValue({
        id: 'acc-1',
        password: '$2a$12$hash',
        user: { id: 'u-1', tenantId: 'T1', isActive: opts.accountActive !== false },
        passwordResetExpiresAt: opts.recentToken ? recentExpiresAt : null,
      }),
    };
    const prisma: any = {
      account: { update: jest.fn().mockResolvedValue({}) },
      authLog: { create: jest.fn() },
    };
    const hostConfig: any = { buildTenantUrl: jest.fn().mockReturnValue('https://x.test/reset?token=Y') };
    const service = new PasswordResetService(prisma as any, identity as any, hostConfig);
    return { service, identity, prisma };
  }

  it('skip si un token a été émis dans la dernière heure', async () => {
    const { service, prisma } = makeService({ recentToken: true });
    await service.initiateBySelf('T1', 'trans-express', 'target@victim.com', '1.2.3.4');
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('émet un nouveau token si pas de token récent', async () => {
    const { service, prisma } = makeService({ recentToken: false });
    await service.initiateBySelf('T1', 'trans-express', 'legit@user.com', '1.2.3.4');
    expect(prisma.account.update).toHaveBeenCalledTimes(1);
    const call = (prisma.account.update as jest.Mock).mock.calls[0][0];
    expect(call.data.passwordResetTokenHash).toBeDefined();
    expect(call.data.passwordResetExpiresAt).toBeInstanceOf(Date);
  });

  it('skip silencieux si email inconnu (anti-énumération)', async () => {
    const { service, prisma, identity } = makeService({ recentToken: false });
    (identity.findCredentialAccount as jest.Mock).mockResolvedValueOnce(null);
    await service.initiateBySelf('T1', 'trans-express', 'unknown@nowhere.com', '1.2.3.4');
    expect(prisma.account.update).not.toHaveBeenCalled();
  });

  it('skip silencieux si account inactif (anti-énumération)', async () => {
    const { service, prisma } = makeService({ recentToken: false, accountActive: false });
    await service.initiateBySelf('T1', 'trans-express', 'disabled@user.com', '1.2.3.4');
    expect(prisma.account.update).not.toHaveBeenCalled();
  });
});
