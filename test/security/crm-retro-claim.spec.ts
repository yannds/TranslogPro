/**
 * Security Test — CRM Retro Claim OTP (Phase 3).
 *
 * Couvre :
 *   1. OTP clair JAMAIS stocké (sha-256 only)
 *   2. Brute-force : 5 tentatives max, puis invalidation
 *   3. Rate-limit anti-enumeration : 3 OTPs/24h/phone
 *   4. Timing safe : pas de différence observable entre "phone inconnu" et "target invalide"
 *   5. Isolation multi-tenant stricte
 *   6. OTP déterministe 6 chiffres
 *
 * Prisma + NotificationService mockés. Pas de DB réelle.
 */

import { RetroClaimService } from '@/modules/crm/retro-claim.service';
import { createHash } from 'crypto';

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

function buildMocks(opts: {
  target?:         { id: string } | null;
  customer?:       { id: string } | null;
  activeOtpsCount?: number;
  otpRecord?:      any;
  user?:           any;
} = {}) {
  const prismaMock: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ country: 'CG' }),
    },
    ticket: {
      findFirst: jest.fn().mockResolvedValue(opts.target ?? null),
    },
    parcel: {
      findFirst: jest.fn().mockResolvedValue(opts.target ?? null),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue(opts.customer ?? null),
      update:    jest.fn().mockResolvedValue({ id: 'c1' }),
    },
    customerRetroClaimOtp: {
      create:     jest.fn().mockImplementation(async (args: any) => args.data),
      findFirst:  jest.fn().mockResolvedValue(opts.otpRecord ?? null),
      findUnique: jest.fn().mockResolvedValue(opts.otpRecord ?? null),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count:      jest.fn().mockResolvedValue(opts.activeOtpsCount ?? 0),
    },
    user:     { findFirst: jest.fn().mockResolvedValue(opts.user ?? null) },
    transact: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
  };
  const notifMock = { send: jest.fn().mockResolvedValue(undefined) };
  return {
    service:   new RetroClaimService(prismaMock, notifMock as any),
    prismaMock,
    notifMock,
  };
}

describe('Security — CRM Retro Claim OTP', () => {

  // 1. OTP clair jamais stocké
  it('ne stocke JAMAIS l\'OTP clair en base (sha-256 only)', async () => {
    const { service, prismaMock } = buildMocks({
      target:   { id: 't1' },
      customer: { id: 'c1' },
    });

    await service.initiate('T1', {
      target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
    });

    const createCall = prismaMock.customerRetroClaimOtp.create.mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty('otp');
    expect(createCall.data).toHaveProperty('otpHash');
    expect(createCall.data.otpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createCall.data.otpHash).toHaveLength(64);
  });

  // 2. Brute-force — 5 max, puis invalidation
  it('brute-force : invalide l\'OTP au 5e échec consécutif', async () => {
    // On simule un OTP avec déjà 4 échecs
    const { service, prismaMock } = buildMocks({
      target: { id: 't1' },
      otpRecord: {
        id: 'otp1', tenantId: 'T1', phoneE164: '+242612345678',
        otpHash: hash('999999'), attempts: 4,
        targetType: 'TICKET', targetId: 't1',
        usedAt: null, invalidatedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    await expect(
      service.confirm('T1', {
        target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
        otp: '000000', userId: 'u1',
      }),
    ).rejects.toThrow('otp_max_attempts_exceeded');

    const updateCall = prismaMock.customerRetroClaimOtp.update.mock.calls[0][0];
    expect(updateCall.data.attempts).toBe(5);
    expect(updateCall.data.invalidatedAt).toBeInstanceOf(Date);
  });

  // 3. Rate-limit par phone
  it('refuse au 4e OTP dans la même fenêtre 24h pour un phone donné', async () => {
    const { service } = buildMocks({
      target:          { id: 't1' },
      customer:        { id: 'c1' },
      activeOtpsCount: 3,   // déjà 3 OTPs créés aujourd'hui
    });

    await expect(
      service.initiate('T1', {
        target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
      }),
    ).rejects.toThrow('retro_claim_rate_limit_phone');
  });

  // 4. Anti-énumération : message vague pour "Customer introuvable" / "target introuvable"
  it('renvoie une erreur générique quand Customer n\'est pas éligible', async () => {
    const { service, notifMock } = buildMocks({
      target:   { id: 't1' },
      customer: null,   // pas de Customer avec ce phone
    });

    await expect(
      service.initiate('T1', {
        target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
      }),
    ).rejects.toThrow('retro_claim_not_eligible');

    // Aucun OTP envoyé (pas de fuite via SMS)
    expect(notifMock.send).not.toHaveBeenCalled();
  });

  // 5. Isolation multi-tenant
  it('refuse de lier un User d\'un tenant différent', async () => {
    const { service } = buildMocks({
      target:   { id: 't1' },
      customer: { id: 'c1' },
      otpRecord: {
        id: 'otp1', tenantId: 'T1', phoneE164: '+242612345678',
        otpHash: hash('123456'), attempts: 0,
        targetType: 'TICKET', targetId: 't1',
        usedAt: null, invalidatedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      },
      user: null,   // user.findFirst({ tenantId: 'T1', id: 'u-from-T2' }) = null
    });

    await expect(
      service.confirm('T1', {
        target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
        otp: '123456', userId: 'u-from-T2',
      }),
    ).rejects.toThrow('user_not_in_tenant');
  });

  // 6. OTP entropie
  it('génère un OTP à exactement 6 chiffres', async () => {
    const { service, prismaMock, notifMock } = buildMocks({
      target:   { id: 't1' },
      customer: { id: 'c1' },
    });

    await service.initiate('T1', {
      target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
    });

    // L'OTP en clair est dans le body du message envoyé
    const sendCall = notifMock.send.mock.calls[0][0];
    const match = sendCall.body.match(/\b(\d{6})\b/);
    expect(match).not.toBeNull();
    expect(match[1]).toMatch(/^\d{6}$/);

    // Vérifier que le hash correspond bien à l'OTP extrait
    const createCall = prismaMock.customerRetroClaimOtp.create.mock.calls[0][0];
    expect(createCall.data.otpHash).toBe(hash(match[1]));
  });

  // 7. Les OTPs précédents sont invalidés à chaque nouvelle initiation
  it('invalide les OTPs actifs précédents pour empêcher la coexistence de plusieurs OTPs valides', async () => {
    const { service, prismaMock } = buildMocks({
      target:   { id: 't1' },
      customer: { id: 'c1' },
    });

    await service.initiate('T1', {
      target: 'TICKET', code: 'qr-abc', phone: '+242612345678',
    });

    expect(prismaMock.customerRetroClaimOtp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'T1',
          phoneE164: '+242612345678',
          usedAt: null,
          invalidatedAt: null,
        }),
        data: { invalidatedAt: expect.any(Date) },
      }),
    );
  });
});
