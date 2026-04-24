import { CustomerClaimService } from '../../../src/modules/crm/customer-claim.service';
import { createHash } from 'crypto';

/**
 * Tests unitaires CustomerClaimService — génération/hash du token,
 * one-shot, expiration, multi-tenant isolation, masquage PII.
 *
 * Prisma + NotificationService mockés.
 */

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('CustomerClaimService', () => {
  let prismaMock: any;
  let notifMock:  any;
  let service:    CustomerClaimService;

  beforeEach(() => {
    prismaMock = {
      customer: {
        findFirst:         jest.fn(),
        findUnique:        jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirstOrThrow:  jest.fn(),
        update:            jest.fn(),
      },
      customerClaimToken: {
        create:     jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        findFirst:  jest.fn().mockResolvedValue(null), // cooldown miss
        count:      jest.fn().mockResolvedValue(0),    // budget miss
        update:     jest.fn(),
      },
      tenantBusinessConfig: {
        findUnique: jest.fn().mockResolvedValue({
          dailyMagicLinkBudget:        200,
          magicLinkPhoneCooldownHours: 24,
        }),
      },
      ticket:   { count: jest.fn().mockResolvedValue(2) },
      parcel:   { count: jest.fn().mockResolvedValue(1) },
      user:     { findFirst: jest.fn() },
      transact: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
    };
    notifMock = { send: jest.fn().mockResolvedValue(undefined) };
    const appConfigMock: any = { publicPortalUrl: 'https://portail.translog.test' };
    service = new CustomerClaimService(prismaMock, notifMock, appConfigMock);
  });

  describe('issueToken()', () => {
    it('retourne null si Customer déjà lié à un User', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);   // filtered userId:null
      const res = await service.issueToken('T1', 'c1');
      expect(res).toBeNull();
      expect(prismaMock.customerClaimToken.create).not.toHaveBeenCalled();
    });

    it('retourne null si Customer n\'a ni phone ni email', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', phoneE164: null, email: null, name: 'X', userId: null, language: null,
      });
      const res = await service.issueToken('T1', 'c1');
      expect(res).toBeNull();
    });

    it('stocke le HASH du token, jamais le clair', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie', userId: null, language: 'fr',
      });
      prismaMock.customerClaimToken.create.mockImplementation(async (args: any) => args.data);

      const res = await service.issueToken('T1', 'c1');
      expect(res).not.toBeNull();
      const clearToken = res!.token;
      const createArgs = prismaMock.customerClaimToken.create.mock.calls[0][0];
      expect(createArgs.data.tokenHash).toBe(hash(clearToken));
      expect(createArgs.data).not.toHaveProperty('token'); // jamais de clair
      expect(createArgs.data.tokenHash).not.toBe(clearToken);
    });

    it('invalide les tokens actifs précédents avant d\'en créer un nouveau', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie', userId: null, language: null,
      });
      prismaMock.customerClaimToken.create.mockResolvedValueOnce({});

      await service.issueToken('T1', 'c1');

      expect(prismaMock.customerClaimToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            customerId: 'c1',
            usedAt: null,
            invalidatedAt: null,
          }),
          data: expect.objectContaining({ invalidatedAt: expect.any(Date) }),
        }),
      );
    });

    it('dispatche WhatsApp puis SMS en fallback pour un Customer avec phone', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie', userId: null, language: 'fr',
      });
      prismaMock.customerClaimToken.create.mockResolvedValueOnce({});

      await service.issueToken('T1', 'c1');

      const channels = notifMock.send.mock.calls.map((c: any) => c[0].channel);
      expect(channels).toContain('WHATSAPP');
      expect(channels).toContain('SMS');
    });

    it('dispatche EMAIL si Customer n\'a que l\'email', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', phoneE164: null, email: 'marie@example.com', name: 'Marie', userId: null, language: null,
      });
      prismaMock.customerClaimToken.create.mockResolvedValueOnce({});

      await service.issueToken('T1', 'c1');

      expect(notifMock.send).toHaveBeenCalledWith(expect.objectContaining({ channel: 'EMAIL' }));
    });
  });

  describe('previewToken()', () => {
    it('refuse les tokens expirés', async () => {
      prismaMock.customerClaimToken.findUnique.mockResolvedValue({
        id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_WHATSAPP',
        expiresAt: new Date(Date.now() - 1000), usedAt: null, invalidatedAt: null,
      });
      await expect(service.previewToken('deadbeef'.repeat(8))).rejects.toThrow(/expir/i);
    });

    it('refuse les tokens déjà utilisés', async () => {
      prismaMock.customerClaimToken.findUnique.mockResolvedValue({
        id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_SMS',
        expiresAt: new Date(Date.now() + 3600_000), usedAt: new Date(), invalidatedAt: null,
      });
      await expect(service.previewToken('deadbeef'.repeat(8))).rejects.toThrow(/d\u00e9j\u00e0 utilis\u00e9|used/i);
    });

    it('masque phone et email dans le preview', async () => {
      prismaMock.customerClaimToken.findUnique.mockResolvedValue({
        id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_WHATSAPP',
        expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
      });
      // Post-audit sécu : previewToken utilise findFirstOrThrow avec tenantId
      prismaMock.customer.findFirstOrThrow.mockResolvedValue({
        firstName: 'Marie', name: 'Marie Ngouabi',
        phoneE164: '+242612345678', email: 'marie@example.com',
      });

      const preview = await service.previewToken('deadbeef'.repeat(8));
      expect(preview.phoneMasked).toMatch(/\+242.*•/);
      expect(preview.phoneMasked).not.toContain('612345678');
      expect(preview.emailMasked).toMatch(/.•.*@/);
      expect(preview.emailMasked).not.toBe('marie@example.com');
    });
  });

  describe('completeToken()', () => {
    it('refuse de lier un User d\'un autre tenant (isolation)', async () => {
      prismaMock.customerClaimToken.findUnique
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_WHATSAPP',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        });
      prismaMock.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null });
      prismaMock.user.findFirst.mockResolvedValue(null);  // user pas dans T1

      await expect(service.completeToken('x'.repeat(32), 'u-from-T2')).rejects.toThrow(/not found|non trouv\u00e9|introuvable/i);
    });

    it('refuse si Customer est déjà rattaché à un User', async () => {
      prismaMock.customerClaimToken.findUnique
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_WHATSAPP',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        });
      prismaMock.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'already-linked' });
      prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', customerProfile: null });

      await expect(service.completeToken('x'.repeat(32), 'u1')).rejects.toThrow(/d\u00e9j\u00e0 rattach|already/i);
    });

    it('consomme le token (usedAt set) après liaison réussie', async () => {
      prismaMock.customerClaimToken.findUnique
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1', channel: 'MAGIC_WHATSAPP',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        })
        .mockResolvedValueOnce({
          id: 'tk', tenantId: 'T1', customerId: 'c1',
          expiresAt: new Date(Date.now() + 3600_000), usedAt: null, invalidatedAt: null,
        });
      prismaMock.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null });
      prismaMock.user.findFirst.mockResolvedValue({ id: 'u1', customerProfile: null });

      const res = await service.completeToken('x'.repeat(32), 'u1');

      expect(res).toEqual({ customerId: 'c1' });
      expect(prismaMock.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
      );
      expect(prismaMock.customerClaimToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
      );
    });
  });
});
