/**
 * ParcelService.transition — guard "freight closed" sur action LOAD.
 *
 * Une fois `Trip.freightClosedAt` posé (cf. FlightDeckService.closeFreight),
 * toute tentative de LOAD ultérieure d'un colis lié à ce trip doit être
 * refusée — on ne peut plus charger de fret après la clôture.
 *
 * Les autres actions (ARRIVE, DELIVER) restent permises : elles concernent
 * la phase post-départ et ne touchent pas au verrou chargement.
 */

import { BadRequestException } from '@nestjs/common';
import { ParcelService } from '../../../src/modules/parcel/parcel.service';

describe('ParcelService.transition — freight closed guard', () => {
  let prismaMock: any;
  let workflowMock: any;
  let service: ParcelService;

  beforeEach(() => {
    prismaMock = {
      parcel: {
        findFirst: jest.fn(),
        update:    jest.fn(),
      },
      trip: {
        findFirst: jest.fn(),
      },
    };
    workflowMock = {
      transition: jest.fn().mockResolvedValue({ entity: { id: 'P1', status: 'LOADED' }, toState: 'LOADED', fromState: 'PACKED' }),
    };
    service = new ParcelService(
      prismaMock,
      workflowMock,
      {} as any, // crmResolver
      {} as any, // crmClaim
      {} as any, // notification
      { publish: jest.fn() } as any, // eventBus
    );
  });

  it('refuse LOAD si Trip.freightClosedAt est posé', async () => {
    prismaMock.parcel.findFirst.mockResolvedValue({
      id: 'P1', tenantId: 'tenant', status: 'PACKED', version: 1,
      shipment: { id: 'S1', tripId: 'T1', status: 'OPEN' },
    });
    prismaMock.trip.findFirst.mockResolvedValue({
      freightClosedAt: new Date('2026-04-19T18:00:00.000Z'),
    });

    await expect(
      service.transition('tenant', 'P1', 'LOAD', { id: 'u1' } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.transition('tenant', 'P1', 'LOAD', { id: 'u1' } as any),
    ).rejects.toThrow(/Chargement clôturé/);

    expect(workflowMock.transition).not.toHaveBeenCalled();
  });

  it('autorise LOAD si freightClosedAt est null', async () => {
    prismaMock.parcel.findFirst.mockResolvedValue({
      id: 'P1', tenantId: 'tenant', status: 'PACKED', version: 1,
      shipment: { id: 'S1', tripId: 'T1', status: 'OPEN' },
    });
    prismaMock.trip.findFirst.mockResolvedValue({ freightClosedAt: null });

    await service.transition('tenant', 'P1', 'LOAD', { id: 'u1' } as any);

    expect(workflowMock.transition).toHaveBeenCalled();
  });

  it('autorise ARRIVE même si freightClosedAt est posé (verrou ne concerne que LOAD)', async () => {
    prismaMock.parcel.findFirst.mockResolvedValue({
      id: 'P1', tenantId: 'tenant', status: 'IN_TRANSIT', version: 1,
      shipment: { id: 'S1', tripId: 'T1', status: 'OPEN' },
    });

    await service.transition('tenant', 'P1', 'ARRIVE', { id: 'u1' } as any);

    // Le check trip.findFirst pour freightClosedAt n'est pas appelé pour ARRIVE
    expect(prismaMock.trip.findFirst).not.toHaveBeenCalled();
    expect(workflowMock.transition).toHaveBeenCalled();
  });

  it('autorise LOAD si parcel sans shipment (pas de tripId) — cas dépôt sans trajet', async () => {
    prismaMock.parcel.findFirst.mockResolvedValue({
      id: 'P1', tenantId: 'tenant', status: 'PACKED', version: 1,
      shipment: null,
    });

    await service.transition('tenant', 'P1', 'LOAD', { id: 'u1' } as any);

    expect(prismaMock.trip.findFirst).not.toHaveBeenCalled();
    expect(workflowMock.transition).toHaveBeenCalled();
  });
});
