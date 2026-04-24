/**
 * TripSafetyAlertService — Tests unitaires.
 * Couvre : raise (avec publish), list (filtres), resolve, cas d'erreur.
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TripSafetyAlertService }                   from '@modules/crew-briefing/trip-safety-alert.service';
import { PrismaService }                            from '@infra/database/prisma.service';

const TENANT_ID = 'tenant-1';
const TRIP_ID   = 'trip-1';
const ALERT_ID  = 'alert-1';

function makePrisma(opts: {
  trip?:   object | null;
  alert?:  object | null;
  listRows?: object[];
} = {}): PrismaService {
  return {
    trip: {
      findFirst: jest.fn().mockResolvedValue('trip' in opts ? opts.trip : { id: TRIP_ID }),
    },
    tripSafetyAlert: {
      create:    jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...data, id: ALERT_ID, createdAt: new Date() })),
      findMany:  jest.fn().mockResolvedValue(opts.listRows ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.alert ?? null),
      update:    jest.fn().mockImplementation(({ data, where }) => Promise.resolve({ id: where.id, tripId: TRIP_ID, code: 'X', ...data })),
    },
  } as unknown as PrismaService;
}

describe('TripSafetyAlertService', () => {
  let svc: TripSafetyAlertService;
  let publishSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    publishSpy = jest.fn().mockResolvedValue(undefined);
  });

  it('raise() crée l\'alerte, publish TRIP_SAFETY_ALERT_RAISED', async () => {
    const prisma = makePrisma();
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    const alert = await svc.raise(TENANT_ID, {
      tripId:   TRIP_ID,
      severity: 'WARNING',
      source:   'BRIEFING',
      code:     'MANDATORY_ITEM_FAILED',
      payload:  { itemCode: 'DOC_ASSURANCE' },
    });

    expect(alert.id).toBe(ALERT_ID);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].type).toBe('trip.safety_alert.raised');
    expect(publishSpy.mock.calls[0][0].payload.code).toBe('MANDATORY_ITEM_FAILED');
  });

  it('raise() lève NotFoundException si trip introuvable pour ce tenant', async () => {
    const prisma = makePrisma({ trip: null });
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    await expect(svc.raise(TENANT_ID, {
      tripId:   'unknown',
      severity: 'WARNING',
      source:   'BRIEFING',
      code:     'X',
    })).rejects.toThrow(NotFoundException);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('list() filtre par tripId + resolved=false', async () => {
    const prisma = makePrisma({ listRows: [{ id: 'a', resolvedAt: null }] });
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    const rows = await svc.list(TENANT_ID, { tripId: TRIP_ID, resolved: false });

    expect(rows).toHaveLength(1);
    expect((prisma.tripSafetyAlert.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      tenantId:   TENANT_ID,
      tripId:     TRIP_ID,
      resolvedAt: null,
    });
  });

  it('resolve() met à jour l\'alerte et publish TRIP_SAFETY_ALERT_RESOLVED', async () => {
    const prisma = makePrisma({ alert: { id: ALERT_ID, tripId: TRIP_ID, resolvedAt: null } });
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    const result = await svc.resolve(TENANT_ID, ALERT_ID, {
      resolvedById:   'user-manager',
      resolutionNote: 'Équipement complété sur place',
    });

    expect(result.resolvedById).toBe('user-manager');
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].type).toBe('trip.safety_alert.resolved');
  });

  it('resolve() lève BadRequestException si alerte déjà résolue', async () => {
    const prisma = makePrisma({ alert: { id: ALERT_ID, tripId: TRIP_ID, resolvedAt: new Date() } });
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    await expect(svc.resolve(TENANT_ID, ALERT_ID, { resolvedById: 'u' }))
      .rejects.toThrow(BadRequestException);
  });

  it('resolve() lève NotFoundException si alerte introuvable', async () => {
    const prisma = makePrisma({ alert: null });
    svc = new TripSafetyAlertService(prisma, { publish: publishSpy } as any);

    await expect(svc.resolve(TENANT_ID, 'unknown', { resolvedById: 'u' }))
      .rejects.toThrow(NotFoundException);
  });
});
