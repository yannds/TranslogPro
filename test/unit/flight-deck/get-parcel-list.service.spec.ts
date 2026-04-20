/**
 * Unit tests — FlightDeckService.getParcelList (Sprint 3).
 *
 * Couvre le contrat consommé par mobile LiveManifestPanel + web QuaiManifest :
 *   - Filtre tenantId strict (cross-tenant isolation applicative)
 *   - Filtre par tripId via shipment.tripId (jointure correcte)
 *   - Exclusion des CANCELLED (colis annulés disparaissent du manifeste vivant)
 *   - Select minimal (id, trackingCode, status, weight, destination)
 *   - Tri par trackingCode asc (prévisible pour l'agent)
 *
 * Prisma est mocké — on vérifie la forme exacte de la query.
 */

jest.mock('@pdfme/generator', () => ({ generate: jest.fn() }), { virtual: true });
jest.mock('@pdfme/common', () => ({}), { virtual: true });
jest.mock('@pdfme/schemas', () => ({ text: {}, image: {}, barcodes: {}, rectangle: {}, line: {}, ellipse: {}, table: {} }), { virtual: true });

import { FlightDeckService } from '../../../src/modules/flight-deck/flight-deck.service';

describe('FlightDeckService.getParcelList', () => {
  let prismaMock: any;
  let service:    FlightDeckService;

  beforeEach(() => {
    prismaMock = {
      parcel: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new FlightDeckService(
      prismaMock,
      {} as any, // TravelerService
      {} as any, // WorkflowEngine
    );
  });

  it('scope tenantId strict (aucun cross-tenant leak)', async () => {
    await service.getParcelList('tenant-a', 'trip-1');

    expect(prismaMock.parcel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });

  it('filtre par shipment.tripId (jointure)', async () => {
    await service.getParcelList('tenant-a', 'trip-xyz');

    const call = prismaMock.parcel.findMany.mock.calls[0][0];
    expect(call.where.shipment).toEqual({ tripId: 'trip-xyz' });
  });

  it('exclut les CANCELLED du manifeste vivant', async () => {
    await service.getParcelList('tenant-a', 'trip-1');

    const call = prismaMock.parcel.findMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ notIn: ['CANCELLED'] });
  });

  it('select minimal : pas de données sensibles non nécessaires', async () => {
    await service.getParcelList('tenant-a', 'trip-1');

    const call = prismaMock.parcel.findMany.mock.calls[0][0];
    expect(call.select).toEqual({
      id:           true,
      trackingCode: true,
      status:       true,
      weight:       true,
      destination:  { select: { id: true, name: true, city: true } },
    });
  });

  it('tri par trackingCode ascendant (prévisible pour l\'agent)', async () => {
    await service.getParcelList('tenant-a', 'trip-1');

    const call = prismaMock.parcel.findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ trackingCode: 'asc' });
  });

  it('retourne la liste fournie par Prisma (pass-through)', async () => {
    prismaMock.parcel.findMany.mockResolvedValueOnce([
      { id: 'p1', trackingCode: 'CODE-1', status: 'LOADED', weight: 5, destination: null },
      { id: 'p2', trackingCode: 'CODE-2', status: 'ARRIVED', weight: 3, destination: { id: 'st1', name: 'Gare X', city: 'X' } },
    ]);
    const res = await service.getParcelList('tenant-a', 'trip-1');
    expect(res).toHaveLength(2);
    expect(res[0].trackingCode).toBe('CODE-1');
  });
});
