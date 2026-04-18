import { RetroClaimService } from '../../../src/modules/crm/retro-claim.service';
import { createHash } from 'crypto';

/**
 * Tests unitaires RetroClaimService — Phase 3 claim rétroactif avec OTP.
 *
 * Couvre :
 *   - initiate() : phone normalisé, target résolu, Customer eligible, rate-limit, OTP stocké hashé
 *   - confirm()  : OTP vérifié, usedAt set, Customer.userId lié
 *   - sécurité   : max 5 attempts, isolation tenant, erreurs génériques
 */

const hash = (v: string) => createHash('sha256').update(v).digest('hex');

describe('RetroClaimService', () => {
  let prismaMock: any;
  let notifMock:  any;
  let service:    RetroClaimService;

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ country: 'CG' }),
      },
      ticket: {
        findFirst: jest.fn(),
      },
      parcel: {
        findFirst: jest.fn(),
      },
      customer: {
        findFirst: jest.fn(),
        update:    jest.fn(),
      },
      customerRetroClaimOtp: {
        create:     jest.fn().mockImplementation(async (args: any) => ({ id: 'otp1', ...args.data })),
        findFirst:  jest.fn(),
        findUnique: jest.fn(),
        update:     jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count:      jest.fn().mockResolvedValue(0),
      },
      user: { findFirst: jest.fn() },
      transact: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
    };
    notifMock = { send: jest.fn().mockResolvedValue(undefined) };
    service = new RetroClaimService(prismaMock, notifMock);
  });

  // ─── initiate() ────────────────────────────────────────────────────────────
  describe('initiate()', () => {
    it('normalise le phone avant lookup (E.164 via country du tenant)', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });

      await service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: '06 12 34 56 78' });

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'T1', phoneE164: '+242612345678' }),
        }),
      );
    });

    it('rejette avec message générique si Customer introuvable (anti-énumération)', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: '+242612345678' }),
      ).rejects.toThrow('retro_claim_not_eligible');

      expect(notifMock.send).not.toHaveBeenCalled();
    });

    it('rejette si phone invalide (sans fuite)', async () => {
      await expect(
        service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: 'not-a-phone' }),
      ).rejects.toThrow('phone_invalid');
    });

    it('stocke le HASH de l\'OTP, jamais le clair', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });

      await service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: '+242612345678' });

      const createArgs = prismaMock.customerRetroClaimOtp.create.mock.calls[0][0];
      expect(createArgs.data).toHaveProperty('otpHash');
      expect(createArgs.data).not.toHaveProperty('otp');
      expect(createArgs.data.otpHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rate-limit : refuse au 4e OTP dans les 24h', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.customerRetroClaimOtp.count.mockResolvedValue(3);

      await expect(
        service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: '+242612345678' }),
      ).rejects.toThrow('retro_claim_rate_limit_phone');
    });

    it('invalide les OTPs précédents actifs pour le même (phone, target)', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });

      await service.initiate('T1', { target: 'TICKET', code: 'qr-123', phone: '+242612345678' });

      expect(prismaMock.customerRetroClaimOtp.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'T1', phoneE164: '+242612345678',
            targetType: 'TICKET', targetId: 't1',
            usedAt: null, invalidatedAt: null,
          }),
          data: { invalidatedAt: expect.any(Date) },
        }),
      );
    });

    it('fallback SMS si WhatsApp échoue', async () => {
      prismaMock.parcel.findFirst.mockResolvedValue({ id: 'p1' });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });
      notifMock.send
        .mockRejectedValueOnce(new Error('WA down'))
        .mockResolvedValueOnce(undefined);

      const res = await service.initiate('T1', { target: 'PARCEL', code: 'TRK-1', phone: '+242612345678' });
      expect(res.channel).toBe('SMS');
      expect(notifMock.send).toHaveBeenCalledTimes(2);
    });
  });

  // ─── confirm() ─────────────────────────────────────────────────────────────
  describe('confirm()', () => {
    function seedActiveOtp(otp: string) {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customerRetroClaimOtp.findFirst.mockResolvedValue({
        id: 'otp1', tenantId: 'T1', phoneE164: '+242612345678',
        otpHash: hash(otp), attempts: 0,
        targetType: 'TICKET', targetId: 't1',
        usedAt: null, invalidatedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      });
      prismaMock.customerRetroClaimOtp.findUnique.mockResolvedValue({
        id: 'otp1', usedAt: null, invalidatedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      });
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'c1' });
      prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', customerProfile: null });
    }

    it('rejette si OTP introuvable/expiré (message générique)', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customerRetroClaimOtp.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm('T1', {
          target: 'TICKET', code: 'qr-123', phone: '+242612345678',
          otp: '000000', userId: 'u1',
        }),
      ).rejects.toThrow('otp_not_found_or_expired');
    });

    it('incrémente attempts si OTP incorrect, sans dépasser 5', async () => {
      seedActiveOtp('123456');

      await expect(
        service.confirm('T1', {
          target: 'TICKET', code: 'qr-123', phone: '+242612345678',
          otp: '000000', userId: 'u1',
        }),
      ).rejects.toThrow('otp_invalid');

      expect(prismaMock.customerRetroClaimOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: 1 } }),
      );
    });

    it('après 5 tentatives ratées, invalide l\'OTP et renvoie forbidden', async () => {
      prismaMock.ticket.findFirst.mockResolvedValue({ id: 't1' });
      prismaMock.customerRetroClaimOtp.findFirst.mockResolvedValue({
        id: 'otp1', tenantId: 'T1', phoneE164: '+242612345678',
        otpHash: hash('123456'), attempts: 4, // 5e échec = invalidation
        targetType: 'TICKET', targetId: 't1',
        usedAt: null, invalidatedAt: null,
        expiresAt: new Date(Date.now() + 300_000),
      });

      await expect(
        service.confirm('T1', {
          target: 'TICKET', code: 'qr-123', phone: '+242612345678',
          otp: '000000', userId: 'u1',
        }),
      ).rejects.toThrow('otp_max_attempts_exceeded');

      const updateCall = prismaMock.customerRetroClaimOtp.update.mock.calls[0][0];
      expect(updateCall.data.attempts).toBe(5);
      expect(updateCall.data.invalidatedAt).toEqual(expect.any(Date));
    });

    it('succès : consomme OTP et lie Customer.userId', async () => {
      seedActiveOtp('987654');

      const res = await service.confirm('T1', {
        target: 'TICKET', code: 'qr-123', phone: '+242612345678',
        otp: '987654', userId: 'u1',
      });

      expect(res).toEqual({ customerId: 'c1', targetId: 't1' });
      expect(prismaMock.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c1' },
          data:  expect.objectContaining({ userId: 'u1' }),
        }),
      );
      expect(prismaMock.customerRetroClaimOtp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });

    it('refuse un User d\'un autre tenant (isolation)', async () => {
      seedActiveOtp('123456');
      prismaMock.user.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm('T1', {
          target: 'TICKET', code: 'qr-123', phone: '+242612345678',
          otp: '123456', userId: 'u-foreign',
        }),
      ).rejects.toThrow('user_not_in_tenant');
    });

    it('refuse si l\'User est déjà rattaché à un autre Customer', async () => {
      seedActiveOtp('123456');
      prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', customerProfile: { id: 'c-other' } });

      await expect(
        service.confirm('T1', {
          target: 'TICKET', code: 'qr-123', phone: '+242612345678',
          otp: '123456', userId: 'u1',
        }),
      ).rejects.toThrow('user_already_linked');
    });
  });
});
