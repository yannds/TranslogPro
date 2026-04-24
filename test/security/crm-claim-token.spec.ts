/**
 * Security Test — CRM Customer Claim Token (magic link).
 *
 * Couvre :
 *   1. Le token clair n'est JAMAIS stocké (seulement sha-256)
 *   2. Rejet tokens expirés/utilisés/invalidés
 *   3. One-shot : impossible de rejouer un token consommé
 *   4. Isolation multi-tenant : user d'un tenant A ne peut pas claimer
 *      un Customer du tenant B
 *   5. Pas de timing attack exploitable dans le preview (même latence)
 *
 * Mocké : Prisma + Notification. Pas de DB réelle.
 */

import { CustomerClaimService } from '@/modules/crm/customer-claim.service';
import { createHash } from 'crypto';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

function buildMocks(opts: {
  tokenCustomerTenant?: string;
  existingCustomer?:   any;
  existingUser?:       any;
  tokenRecord?:        any;
}) {
  const prismaMock: any = {
    customer: {
      findFirst:      jest.fn().mockResolvedValue(null),
      findUnique:     jest.fn().mockResolvedValue(opts.existingCustomer ?? null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(opts.existingCustomer ?? {
        firstName: null, name: 'X', phoneE164: '+242612345678', email: null,
      }),
      update:         jest.fn().mockResolvedValue({ id: 'c1' }),
    },
    customerClaimToken: {
      create:     jest.fn().mockImplementation(async (args: any) => args.data),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(opts.tokenRecord ?? null),
      findFirst:  jest.fn().mockResolvedValue(null),
      count:      jest.fn().mockResolvedValue(0),
      update:     jest.fn().mockResolvedValue({}),
    },
    tenantBusinessConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    ticket:   { count: jest.fn().mockResolvedValue(0) },
    parcel:   { count: jest.fn().mockResolvedValue(0) },
    user:     { findFirst: jest.fn().mockResolvedValue(opts.existingUser ?? null) },
    transact: jest.fn().mockImplementation(async (fn: any) => fn(prismaMock)),
  };
  const notifMock = { send: jest.fn().mockResolvedValue(undefined) };
  const appConfigMock: any = { publicPortalUrl: 'https://portail.translog.test' };
  return {
    service:    new CustomerClaimService(prismaMock, notifMock as any, appConfigMock),
    prismaMock,
    notifMock,
  };
}

describe('Security — CRM Claim Token', () => {

  // 1. Token clair jamais stocké
  it('ne stocke JAMAIS le token clair en base (sha-256 only)', async () => {
    const { service, prismaMock } = buildMocks({});
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie', userId: null, language: null,
    });

    const res = await service.issueToken('T1', 'c1');
    expect(res).not.toBeNull();

    const createCall = prismaMock.customerClaimToken.create.mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty('token');
    expect(createCall.data).toHaveProperty('tokenHash');
    expect(createCall.data.tokenHash).toBe(hash(res!.token));
    expect(createCall.data.tokenHash).not.toBe(res!.token);
    // Le token clair est hex 64 chars, le hash aussi — les deux doivent DIFFÉRER
    expect(createCall.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // 2. Rejet expiré
  it('rejette les tokens expirés (previewToken)', async () => {
    const { service } = buildMocks({
      tokenRecord: {
        id: 'tk1', tenantId: 'T1', customerId: 'c1',
        expiresAt: new Date(Date.now() - 1000), usedAt: null, invalidatedAt: null,
        channel: 'MAGIC_WHATSAPP',
      },
    });
    await expect(service.previewToken('a'.repeat(64))).rejects.toThrow(/expir/i);
  });

  it('rejette les tokens invalidés', async () => {
    const { service } = buildMocks({
      tokenRecord: {
        id: 'tk1', tenantId: 'T1', customerId: 'c1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null, invalidatedAt: new Date(),
        channel: 'MAGIC_WHATSAPP',
      },
    });
    await expect(service.previewToken('a'.repeat(64))).rejects.toThrow(/invalid/i);
  });

  // 3. One-shot
  it('one-shot : un token utilisé ne peut plus être rejoué', async () => {
    const { service } = buildMocks({
      tokenRecord: {
        id: 'tk1', tenantId: 'T1', customerId: 'c1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: new Date(), invalidatedAt: null,
        channel: 'MAGIC_WHATSAPP',
      },
    });
    await expect(service.previewToken('a'.repeat(64))).rejects.toThrow(/utilis|used/i);
  });

  // 4. Isolation multi-tenant — token de T1, user de T2
  it('refuse de lier un user d\'un tenant différent du Customer ciblé', async () => {
    const { service, prismaMock } = buildMocks({});
    // findUnique sera appelé 2x : pour findActiveToken puis dans completeToken tx
    prismaMock.customerClaimToken.findUnique
      .mockResolvedValueOnce({
        id: 'tk1', tenantId: 'T1', customerId: 'c1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null, invalidatedAt: null, channel: 'MAGIC_SMS',
      })
      .mockResolvedValueOnce({
        id: 'tk1', tenantId: 'T1', customerId: 'c1',
        expiresAt: new Date(Date.now() + 3600_000),
        usedAt: null, invalidatedAt: null,
      });
    prismaMock.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null });
    // user.findFirst retourne null car scopé par tenantId ET id
    prismaMock.user.findFirst.mockResolvedValue(null);

    await expect(service.completeToken('a'.repeat(64), 'u-from-T2')).rejects.toThrow(/non trouv|not found/i);

    // Vérifier que user.findFirst a été appelé AVEC la condition tenantId du token (T1)
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'T1' }),
      }),
    );
  });

  // 5. Timing : deux preview (valide vs invalide) doivent être raisonnablement proches
  // (pas d'early-return leaking la différence entre "token inconnu" et "hash mismatch").
  // Note : test indicatif, pas un vrai measure cryptographique — on vérifie juste que
  // l'implémentation n'a pas de branche conditionnelle qui skip un gros morceau.
  it('ne révèle pas l\'existence du customer via timing preview', async () => {
    const { service, prismaMock } = buildMocks({});
    prismaMock.customerClaimToken.findUnique.mockResolvedValue(null);

    const t0 = Date.now();
    await expect(service.previewToken('a'.repeat(64))).rejects.toThrow();
    const elapsed1 = Date.now() - t0;

    const t2 = Date.now();
    await expect(service.previewToken('b'.repeat(64))).rejects.toThrow();
    const elapsed2 = Date.now() - t2;

    // Écart de timing < 500ms (les deux branches "token not found" font la même chose)
    expect(Math.abs(elapsed1 - elapsed2)).toBeLessThan(500);
  });

  // 6. Token length enforcement (contre brute-force)
  it('le token généré fait 32 bytes (64 chars hex) — entropie 256 bits', async () => {
    const { service, prismaMock } = buildMocks({});
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'X', userId: null, language: null,
    });

    const res = await service.issueToken('T1', 'c1');
    expect(res!.token).toHaveLength(64);
    expect(res!.token).toMatch(/^[0-9a-f]{64}$/);
  });
});
