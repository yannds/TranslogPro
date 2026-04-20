import { AnnouncementService } from '../../../src/modules/announcement/announcement.service';
import { EventTypes } from '../../../src/common/types/domain-event.type';

/**
 * Tests unit — AnnouncementService (2026-04-20).
 *
 * Couvre :
 *   - create (manuel) publie ANNOUNCEMENT_CREATED via EventBus
 *   - update / remove publient les événements correspondants
 *   - createAuto (listener) — idempotence via (tenantId, sourceEventId)
 *   - findAll filtre activeOnly + stationId (incluant les annonces sans station)
 *   - citySlug résolu depuis la station pour fan-out gateway
 */
describe('AnnouncementService', () => {
  const tenantId = 'tenant-a';

  function makeService(opts?: { stationCity?: string | null }) {
    const stationCity = opts?.stationCity !== undefined ? opts.stationCity : 'Brazzaville';
    const prisma: any = {
      announcement: {
        create:     jest.fn().mockImplementation(async ({ data }) => ({ id: 'ann-' + Math.random().toString(36).slice(2, 6), ...data })),
        update:     jest.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data })),
        delete:     jest.fn().mockResolvedValue({ id: 'ann-deleted' }),
        findFirst:  jest.fn(),
        findMany:   jest.fn().mockResolvedValue([]),
      },
      station: {
        findFirst: jest.fn().mockResolvedValue(
          stationCity === null ? null : { city: stationCity },
        ),
      },
      transact: jest.fn().mockImplementation(async (fn: any) => {
        const tx: any = {
          announcement: prisma.announcement,
        };
        return fn(tx);
      }),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new AnnouncementService(prisma, eventBus);
    return { service, prisma, eventBus };
  }

  it('create publie ANNOUNCEMENT_CREATED avec citySlug résolu depuis station', async () => {
    const { service, eventBus } = makeService({ stationCity: 'Pointe-Noire' });
    await service.create(tenantId, {
      stationId: 'st-1',
      title: 'Test',
      message: 'Hello',
      type: 'INFO',
      priority: 0,
    });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = (eventBus.publish as jest.Mock).mock.calls[0][0];
    expect(event.type).toBe(EventTypes.ANNOUNCEMENT_CREATED);
    expect(event.tenantId).toBe(tenantId);
    expect(event.payload.citySlug).toBe('pointe-noire');
    expect(event.payload.source).toBe('MANUAL');
  });

  it('createAuto idempotent : 2e émission même sourceEventId → retour existant', async () => {
    const { service, prisma, eventBus } = makeService();
    // 1er appel → succès
    await service.createAuto(tenantId, {
      type: 'DELAY',
      priority: 7,
      title: 'Retard',
      message: 'Le trajet est retardé',
      sourceEventId: 'evt-xyz',
      tripId: 'trip-1',
    });

    // 2e appel → Prisma P2002 (unique violation)
    (prisma.announcement.create as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    (prisma.announcement.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'ann-existing', sourceEventId: 'evt-xyz' });

    const result = await service.createAuto(tenantId, {
      type: 'DELAY',
      priority: 7,
      title: 'Retard',
      message: 'Le trajet est retardé',
      sourceEventId: 'evt-xyz',
      tripId: 'trip-1',
    });

    expect(result).toEqual(expect.objectContaining({ id: 'ann-existing' }));
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
  });

  it('findAll activeOnly : filtre isActive + startsAt ≤ now + endsAt null|≥now', async () => {
    const { service, prisma } = makeService();
    await service.findAll(tenantId, undefined, /* activeOnly */ true);
    const whereArg = (prisma.announcement.findMany as jest.Mock).mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe(tenantId);
    expect(whereArg.isActive).toBe(true);
    expect(whereArg.startsAt).toEqual({ lte: expect.any(Date) });
    expect(whereArg.OR).toEqual([{ endsAt: null }, { endsAt: { gte: expect.any(Date) } }]);
  });

  it('findAll par station : inclut les annonces globales (stationId=null)', async () => {
    const { service, prisma } = makeService();
    await service.findAll(tenantId, 'st-1', false);
    const whereArg = (prisma.announcement.findMany as jest.Mock).mock.calls[0][0].where;
    // Le filtre station matche st-1 OU null (globale tenant)
    expect(whereArg.OR).toEqual([{ stationId: 'st-1' }, { stationId: null }]);
  });

  it('update publie ANNOUNCEMENT_UPDATED', async () => {
    const { service, prisma, eventBus } = makeService();
    const baseRow = {
      id: 'ann-1', tenantId, stationId: null, tripId: null,
      type: 'INFO', priority: 0, title: 'old', message: 'old',
      startsAt: new Date(), endsAt: null, isActive: true, source: 'MANUAL',
    };
    (prisma.announcement.findFirst as jest.Mock).mockResolvedValueOnce(baseRow);
    // Prisma renvoie la ligne complète après update
    (prisma.announcement.update as jest.Mock).mockResolvedValueOnce({ ...baseRow, title: 'new' });
    await service.update(tenantId, 'ann-1', { title: 'new' });
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = (eventBus.publish as jest.Mock).mock.calls[0][0];
    expect(event.type).toBe(EventTypes.ANNOUNCEMENT_UPDATED);
  });

  it('remove publie ANNOUNCEMENT_DELETED', async () => {
    const { service, prisma, eventBus } = makeService();
    (prisma.announcement.findFirst as jest.Mock).mockResolvedValueOnce({
      id: 'ann-1', tenantId, stationId: null, tripId: null,
      type: 'INFO', priority: 0, title: 't', message: 'm',
      startsAt: new Date(), endsAt: null, isActive: true, source: 'MANUAL',
    });
    await service.remove(tenantId, 'ann-1');
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    const event = (eventBus.publish as jest.Mock).mock.calls[0][0];
    expect(event.type).toBe(EventTypes.ANNOUNCEMENT_DELETED);
  });
});
