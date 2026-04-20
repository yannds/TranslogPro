/**
 * FlightDeckService.closeFreight — verrou métier "Clôturer fret".
 *
 * Couvre :
 *   - Stamp Trip.freightClosedAt + freightClosedById quand vide
 *   - Idempotence : 2e appel = pas de re-stamp, retourne l'état courant
 *   - 404 si trip d'un autre tenant (isolation)
 */

import { NotFoundException } from '@nestjs/common';
import { FlightDeckService } from '../../../src/modules/flight-deck/flight-deck.service';

describe('FlightDeckService.closeFreight', () => {
  let prismaMock: any;
  let service:    FlightDeckService;

  beforeEach(() => {
    prismaMock = {
      trip: {
        findFirst: jest.fn(),
        update:    jest.fn(),
      },
    };
    service = new FlightDeckService(prismaMock, {} as any, {} as any);
  });

  it('stampe freightClosedAt + freightClosedById si vide', async () => {
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff1',
      freightClosedAt: null, freightClosedById: null,
    });
    prismaMock.trip.update.mockImplementation(async ({ data }: any) => ({
      id: 'T', freightClosedAt: data.freightClosedAt, freightClosedById: data.freightClosedById,
    }));

    const res = await service.closeFreight('tenant', 'T', 'user1');

    expect(prismaMock.trip.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.trip.update.mock.calls[0][0].data.freightClosedAt).toBeInstanceOf(Date);
    expect(prismaMock.trip.update.mock.calls[0][0].data.freightClosedById).toBe('user1');
    expect(res.id).toBe('T');
  });

  it('idempotent — 2e appel ne re-stampe pas (préserve audit du 1er actor)', async () => {
    const firstClose = new Date('2026-04-19T18:00:00.000Z');
    prismaMock.trip.findFirst.mockResolvedValue({
      id: 'T', status: 'BOARDING', driverId: 'staff1',
      freightClosedAt: firstClose, freightClosedById: 'first_user',
    });

    const res = await service.closeFreight('tenant', 'T', 'second_user');

    // Pas d'update appelé — on retourne l'existant
    expect(prismaMock.trip.update).not.toHaveBeenCalled();
    expect(res.freightClosedAt).toBe(firstClose);
    expect(res.freightClosedById).toBe('first_user'); // pas écrasé
  });

  it('refuse 404 si trip introuvable dans le tenant (isolation cross-tenant)', async () => {
    prismaMock.trip.findFirst.mockResolvedValue(null);

    await expect(
      service.closeFreight('tenant', 'T_other', 'user1'),
    ).rejects.toThrow(NotFoundException);
  });
});
