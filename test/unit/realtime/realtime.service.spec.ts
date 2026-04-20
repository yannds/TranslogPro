import { firstValueFrom, Subject, take, timeout } from 'rxjs';
import { RealtimeService } from '../../../src/modules/realtime/realtime.service';
import type { DomainEvent } from '../../../src/infrastructure/eventbus/interfaces/eventbus.interface';

/**
 * Tests unitaires RealtimeService (Sprint 6) — stream SSE par tenant.
 *
 * Prisma/Redis mockés. On valide que :
 *   - Observable filtré STRICT par tenantId (isolation cross-tenant garantie)
 *   - Plusieurs tenants peuvent s'abonner indépendamment (multicast)
 *   - Les événements malformés sont ignorés (parse error tolérance)
 *   - onModuleDestroy ferme la connexion Redis + complete le Subject
 */
describe('RealtimeService — tenant isolation', () => {
  let fakeRedis: any;
  let subscriberDouble: any;
  let service: RealtimeService;
  let pmessageHandler: (pattern: string, channel: string, raw: string) => void;

  beforeEach(() => {
    // Double du subscriber Redis (retourné par .duplicate())
    subscriberDouble = {
      connect:    jest.fn().mockResolvedValue(undefined),
      psubscribe: jest.fn().mockResolvedValue(undefined),
      on: jest.fn((event: string, handler: any) => {
        if (event === 'pmessage') pmessageHandler = handler;
      }),
      quit: jest.fn().mockResolvedValue('OK'),
    };

    // Publisher client mock avec .duplicate()
    fakeRedis = {
      duplicate: jest.fn().mockReturnValue(subscriberDouble),
    };

    service = new RealtimeService(fakeRedis as any);
  });

  function fakeEvent(tenantId: string, type = 'ticket.issued'): DomainEvent {
    return {
      id:            `evt-${Math.random()}`,
      type,
      tenantId,
      aggregateId:   'agg-1',
      aggregateType: 'Ticket',
      payload:       {},
      occurredAt:    new Date(),
    };
  }

  it('stream retourne uniquement les événements du tenant demandé', async () => {
    const collected: DomainEvent[] = [];
    service.streamForTenant('tenant-a').pipe(take(2)).subscribe(e => collected.push(e));

    // Attendre init async subscriber
    await new Promise(r => setTimeout(r, 10));

    // Simule 3 événements : 2 pour tenant-a + 1 pour tenant-b
    pmessageHandler('translog:*:*', 'translog:tenant-a:ticket.issued',
      JSON.stringify(fakeEvent('tenant-a')));
    pmessageHandler('translog:*:*', 'translog:tenant-b:incident.created',
      JSON.stringify(fakeEvent('tenant-b', 'incident.created')));
    pmessageHandler('translog:*:*', 'translog:tenant-a:cashregister.closed',
      JSON.stringify(fakeEvent('tenant-a', 'cashregister.closed')));

    // Laisser RxJS flusher
    await new Promise(r => setTimeout(r, 10));

    expect(collected).toHaveLength(2);
    expect(collected.every(e => e.tenantId === 'tenant-a')).toBe(true);
  });

  it('[security] isolation stricte : aucun leak cross-tenant', async () => {
    const aCollected: DomainEvent[] = [];
    const bCollected: DomainEvent[] = [];
    service.streamForTenant('tenant-a').subscribe(e => aCollected.push(e));
    service.streamForTenant('tenant-b').subscribe(e => bCollected.push(e));

    await new Promise(r => setTimeout(r, 10));

    // Émettre 5 événements tenant-a + 3 tenant-b
    for (let i = 0; i < 5; i++) {
      pmessageHandler('translog:*:*', `translog:tenant-a:e${i}`, JSON.stringify(fakeEvent('tenant-a')));
    }
    for (let i = 0; i < 3; i++) {
      pmessageHandler('translog:*:*', `translog:tenant-b:e${i}`, JSON.stringify(fakeEvent('tenant-b')));
    }

    await new Promise(r => setTimeout(r, 10));

    expect(aCollected).toHaveLength(5);
    expect(bCollected).toHaveLength(3);
    expect(aCollected.every(e => e.tenantId === 'tenant-a')).toBe(true);
    expect(bCollected.every(e => e.tenantId === 'tenant-b')).toBe(true);
  });

  it('tolère messages JSON invalides sans crasher', async () => {
    const collected: DomainEvent[] = [];
    service.streamForTenant('tenant-a').subscribe(e => collected.push(e));

    await new Promise(r => setTimeout(r, 10));

    pmessageHandler('translog:*:*', 'translog:tenant-a:ticket.issued', 'not-json-garbage');
    pmessageHandler('translog:*:*', 'translog:tenant-a:ticket.issued',
      JSON.stringify(fakeEvent('tenant-a')));

    await new Promise(r => setTimeout(r, 10));

    expect(collected).toHaveLength(1);
  });

  it('subscribe une seule fois à Redis même avec plusieurs appels streamForTenant', async () => {
    service.streamForTenant('tenant-a');
    service.streamForTenant('tenant-b');
    service.streamForTenant('tenant-c');

    await new Promise(r => setTimeout(r, 20));

    expect(fakeRedis.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriberDouble.psubscribe).toHaveBeenCalledTimes(1);
    expect(subscriberDouble.psubscribe).toHaveBeenCalledWith('translog:*:*');
  });

  it('onModuleDestroy ferme la connexion Redis', async () => {
    service.streamForTenant('tenant-a');
    await new Promise(r => setTimeout(r, 10));

    await service.onModuleDestroy();

    expect(subscriberDouble.quit).toHaveBeenCalled();
  });
});
