import { CustomerClaimService } from '../../../src/modules/crm/customer-claim.service';

/**
 * Tests unit — CustomerClaimService anti-abus (2026-04-20).
 *
 * Deux protections contre le bombardement de magic links :
 *   - Cooldown par phone (24h défaut, configurable TenantBusinessConfig)
 *     → même phone ne reçoit qu'un token par fenêtre
 *   - Budget tenant (200/jour défaut) → stop émission au-delà pour le tenant
 *
 * Les deux skips retournent `null` (fire-and-forget) et loguent en warn.
 */
describe('CustomerClaimService — cooldown + budget anti-abus', () => {
  function makeService(overrides: Partial<{
    bizConfig:  { dailyMagicLinkBudget: number; magicLinkPhoneCooldownHours: number } | null;
    recentByPhone: unknown | null;
    dailyCount: number;
  }>) {
    const prismaMock: any = {
      customer: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'c1', phoneE164: '+242061234567', email: null, name: 'X',
          userId: null, language: 'fr', deletedAt: null,
        }),
        findFirstOrThrow: jest.fn(),
        findUnique:       jest.fn(),
      },
      customerClaimToken: {
        findFirst: jest.fn().mockResolvedValue(overrides.recentByPhone ?? null),
        count:     jest.fn().mockResolvedValue(overrides.dailyCount ?? 0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create:     jest.fn().mockResolvedValue({ id: 'tok-1' }),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn().mockResolvedValue(overrides.bizConfig === null
          ? null
          : (overrides.bizConfig ?? {
              dailyMagicLinkBudget: 200,
              magicLinkPhoneCooldownHours: 24,
            })),
      },
    };
    const notifMock = { send: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new CustomerClaimService(prismaMock, notifMock as any),
      prisma: prismaMock,
      notif:  notifMock,
    };
  }

  it('skip si un token existe déjà pour ce phone dans la fenêtre cooldown', async () => {
    const { service, prisma, notif } = makeService({
      recentByPhone: { id: 'tok-prev', createdAt: new Date(Date.now() - 3600_000) },
    });
    const result = await service.issueToken('T1', 'c1');
    expect(result).toBeNull();
    expect(prisma.customerClaimToken.create).not.toHaveBeenCalled();
    expect(notif.send).not.toHaveBeenCalled();
  });

  it('skip si le budget journalier est atteint', async () => {
    const { service, prisma } = makeService({ dailyCount: 200 });
    const result = await service.issueToken('T1', 'c1');
    expect(result).toBeNull();
    expect(prisma.customerClaimToken.create).not.toHaveBeenCalled();
  });

  it('émet le token si cooldown passé et budget OK', async () => {
    const { service, prisma, notif } = makeService({
      recentByPhone: null,
      dailyCount:    10,
    });
    const result = await service.issueToken('T1', 'c1');
    expect(result).not.toBeNull();
    expect(result?.token).toBeDefined();
    expect(prisma.customerClaimToken.create).toHaveBeenCalledTimes(1);
    expect(notif.send).toHaveBeenCalled();
  });

  it('fallback budget + cooldown si TenantBusinessConfig absent', async () => {
    const { service, prisma } = makeService({ bizConfig: null, dailyCount: 0 });
    const result = await service.issueToken('T1', 'c1');
    expect(result).not.toBeNull();
    expect(prisma.customerClaimToken.create).toHaveBeenCalled();
  });

  it('cooldown ignoré si magicLinkPhoneCooldownHours=0 (tenant disable)', async () => {
    const { service, prisma } = makeService({
      bizConfig: { dailyMagicLinkBudget: 200, magicLinkPhoneCooldownHours: 0 },
      recentByPhone: { id: 'tok-prev', createdAt: new Date(Date.now() - 60_000) },
    });
    const result = await service.issueToken('T1', 'c1');
    expect(result).not.toBeNull();
    expect(prisma.customerClaimToken.create).toHaveBeenCalled();
  });
});
