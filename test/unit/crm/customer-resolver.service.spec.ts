import { CustomerResolverService } from '../../../src/modules/crm/customer-resolver.service';

/**
 * Tests unitaires CustomerResolverService — idempotence, isolation tenant,
 * normalisation phone, fallback email, enrichissement.
 *
 * Prisma est mocké : on vérifie uniquement la logique métier.
 */
describe('CustomerResolverService', () => {
  let prismaMock: any;
  let service:    CustomerResolverService;

  beforeEach(() => {
    prismaMock = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ country: 'CG' }),
      },
      customer: {
        findFirst: jest.fn(),
        create:    jest.fn(),
        update:    jest.fn(),
      },
    };
    service = new CustomerResolverService(prismaMock);
  });

  it('retourne null si ni phone ni email fournis', async () => {
    const res = await service.resolveOrCreate('T1', { name: 'X' });
    expect(res).toBeNull();
    expect(prismaMock.customer.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.customer.create).not.toHaveBeenCalled();
  });

  it('normalise le phone CG avant lookup (E.164)', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce(null);
    prismaMock.customer.findFirst.mockResolvedValueOnce(null);
    prismaMock.customer.create.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie',
    });

    const res = await service.resolveOrCreate('T1', { name: 'Marie', phone: '06 12 34 56 78' });

    expect(res?.created).toBe(true);
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'T1', phoneE164: '+242612345678' }),
      }),
    );
  });

  it('idempotent : même phone → retrouve le même Customer', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie', language: null,
    });
    prismaMock.customer.update.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'Marie',
    });

    const res = await service.resolveOrCreate('T1', { phone: '+242 06 12 34 56 78' });

    expect(res?.created).toBe(false);
    expect(res?.matchedBy).toBe('phone');
    expect(res?.customer.id).toBe('c1');
  });

  it('fallback email si phone absent', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c2', phoneE164: null, email: 'marie@example.com', name: 'Marie', language: null,
    });
    prismaMock.customer.update.mockResolvedValueOnce({
      id: 'c2', phoneE164: null, email: 'marie@example.com', name: 'Marie',
    });

    const res = await service.resolveOrCreate('T1', { email: 'Marie@Example.com' });

    expect(res?.matchedBy).toBe('email');
    expect(prismaMock.customer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'T1', email: 'marie@example.com' }),
      }),
    );
  });

  it('enrichit un Customer existant avec email manquant quand on apprend l\'email', async () => {
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'Client +242612345678', language: null,
    });
    prismaMock.customer.update.mockResolvedValueOnce({
      id: 'c1', phoneE164: '+242612345678', email: 'new@x.com', name: 'Marie Vrai',
    });

    await service.resolveOrCreate('T1', {
      phone: '+242612345678', email: 'new@x.com', name: 'Marie Vrai',
    });

    expect(prismaMock.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          email:      'new@x.com',
          name:       'Marie Vrai',   // remplace le fallback "Client +242…"
          lastSeenAt: expect.any(Date),
        }),
      }),
    );
  });

  it('isolation tenant : le lookup utilise TOUJOURS tenantId en condition', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue({
      id: 'c1', phoneE164: '+242612345678', email: null, name: 'X',
    });

    await service.resolveOrCreate('TENANT-A', { name: 'X', phone: '+242612345678' });

    const firstCall = prismaMock.customer.findFirst.mock.calls[0][0];
    expect(firstCall.where.tenantId).toBe('TENANT-A');
    expect(firstCall.where.deletedAt).toBeNull();
  });

  it('accepte les deletedAt:null — ignore les Customers soft-deleted', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockResolvedValue({
      id: 'new', phoneE164: '+242612345678', email: null, name: 'Nouveau',
    });

    await service.resolveOrCreate('T1', { phone: '+242612345678' });

    expect(prismaMock.customer.findFirst.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('ignore un phone mal formé mais utilise l\'email si dispo', async () => {
    // phone='garbage' → normalizePhone rejette → phoneE164=null →
    // le lookup phone n'est PAS fait, seul le lookup email est effectué.
    prismaMock.customer.findFirst.mockResolvedValueOnce({
      id: 'c3', phoneE164: null, email: 'x@x.com', name: 'Z', language: null,
    });
    prismaMock.customer.update.mockResolvedValueOnce({ id: 'c3', phoneE164: null, email: 'x@x.com', name: 'Z' });

    const res = await service.resolveOrCreate('T1', { phone: 'garbage', email: 'x@x.com' });

    expect(res?.matchedBy).toBe('email');
    expect(prismaMock.customer.findFirst).toHaveBeenCalledTimes(1);
  });

  it('fallback name quand rien fourni', async () => {
    prismaMock.customer.findFirst.mockResolvedValue(null);
    prismaMock.customer.create.mockImplementation(async (args: any) => ({
      id: 'c4', ...args.data,
    }));

    await service.resolveOrCreate('T1', { phone: '+242612345678' });

    expect(prismaMock.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Client +242612345678',
        }),
      }),
    );
  });
});
