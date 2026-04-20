import { CustomerResolverService } from '../../../src/modules/crm/customer-resolver.service';

/**
 * Tests unit — bumpCounters() gating par phoneVerified (2026-04-20).
 *
 * Politique :
 *   - source='PUBLIC' + phoneVerified=false → skip bump (anti-pollution CRM)
 *   - source='PUBLIC' + phoneVerified=true  → bump normal
 *   - source='PUBLIC' + phone=null + email présent → bump (email-only tolérant)
 *   - source='AGENT' → bump + flip phoneVerified=true (présentiel)
 *   - source non précisé (legacy) → bump sans vérifier (comportement historique)
 */
describe('CustomerResolverService.bumpCounters — phoneVerified gating', () => {
  function makeService() {
    const update = jest.fn().mockResolvedValue(undefined);
    const findUnique = jest.fn();
    const prisma: any = { customer: { update, findUnique } };
    const service = new CustomerResolverService(prisma as any);
    return { service, prisma, update, findUnique };
  }

  it('PUBLIC + phone présent + phoneVerified=false → skip increment (pollution-proof)', async () => {
    const { service, findUnique, update } = makeService();
    findUnique.mockResolvedValueOnce({ phoneVerified: false, phoneE164: '+242061234567' });
    await service.bumpCounters(null, 'c1', 'ticket', 10_000n, { source: 'PUBLIC' });
    expect(update).toHaveBeenCalledTimes(1);
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.totalTickets).toBeUndefined();
    expect(data.totalSpentCents).toBeUndefined();
    expect(data.lastSeenAt).toBeInstanceOf(Date);
  });

  it('PUBLIC + phoneVerified=true → bump normal', async () => {
    const { service, findUnique, update } = makeService();
    findUnique.mockResolvedValueOnce({ phoneVerified: true, phoneE164: '+242061234567' });
    await service.bumpCounters(null, 'c1', 'ticket', 10_000n, { source: 'PUBLIC' });
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.totalTickets).toEqual({ increment: 1 });
    expect(data.totalSpentCents).toEqual({ increment: 10_000n });
  });

  it('PUBLIC + phone=null (email-only) → bump (pas de surface téléphone)', async () => {
    const { service, findUnique, update } = makeService();
    findUnique.mockResolvedValueOnce({ phoneVerified: false, phoneE164: null });
    await service.bumpCounters(null, 'c1', 'parcel', 0n, { source: 'PUBLIC' });
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.totalParcels).toEqual({ increment: 1 });
  });

  it('AGENT → bump + flip phoneVerified=true', async () => {
    const { service, update } = makeService();
    await service.bumpCounters(null, 'c1', 'ticket', 5_000n, { source: 'AGENT' });
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.totalTickets).toEqual({ increment: 1 });
    expect(data.phoneVerified).toBe(true);
    expect(data.phoneVerifiedVia).toBe('AGENT_IN_PERSON');
    expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it('source non précisé (legacy) → bump sans gating', async () => {
    const { service, update, findUnique } = makeService();
    await service.bumpCounters(null, 'c1', 'ticket', 1_000n);
    expect(findUnique).not.toHaveBeenCalled();
    const data = (update as jest.Mock).mock.calls[0][0].data;
    expect(data.totalTickets).toEqual({ increment: 1 });
  });
});
