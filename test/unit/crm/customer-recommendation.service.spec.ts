import { CustomerRecommendationService } from '../../../src/modules/crm/customer-recommendation.service';

/**
 * Tests unitaires CustomerRecommendationService — Phase 4.
 *
 * Couvre :
 *   - Isolation tenant stricte
 *   - Calcul du top siège / fare / route à partir de l'historique
 *   - Exclusion des tickets CANCELLED / EXPIRED
 *   - Lookup par phone (normalisation E.164)
 *   - Null si Customer introuvable (byPhone)
 */

describe('CustomerRecommendationService', () => {
  let prismaMock: any;
  let service:    CustomerRecommendationService;

  beforeEach(() => {
    prismaMock = {
      tenant:   { findUnique: jest.fn().mockResolvedValue({ country: 'CG' }) },
      customer: { findFirst: jest.fn() },
      ticket:   { findMany: jest.fn().mockResolvedValue([]) },
      parcel:   { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new CustomerRecommendationService(prismaMock);
  });

  describe('byCustomer()', () => {
    it('lance NotFoundException si Customer introuvable (isolation tenant)', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);

      await expect(service.byCustomer('T1', 'c1')).rejects.toThrow(/not_found/);

      // Condition racine : tenantId en 1er
      const call = prismaMock.customer.findFirst.mock.calls[0][0];
      expect(call.where.tenantId).toBe('T1');
      expect(call.where.deletedAt).toBeNull();
    });

    it('top siège = plus fréquent (hors CANCELLED/EXPIRED)', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', language: null, totalTickets: 3, totalParcels: 0, segments: [],
      });
      prismaMock.ticket.findMany.mockResolvedValueOnce([
        { seatNumber: '3A', fareClass: 'VIP',      boardingStationId: 'bzv', alightingStationId: 'pnr' },
        { seatNumber: '3A', fareClass: 'VIP',      boardingStationId: 'bzv', alightingStationId: 'pnr' },
        { seatNumber: '5B', fareClass: 'STANDARD', boardingStationId: 'bzv', alightingStationId: 'pnr' },
      ]);

      const rec = await service.byCustomer('T1', 'c1');

      expect(rec.topSeat).toBe('3A');
      expect(rec.topFareClass).toBe('VIP');
      expect(rec.topBoardingId).toBe('bzv');
      expect(rec.topAlightingId).toBe('pnr');
    });

    it('exclut les tickets CANCELLED et EXPIRED', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', language: 'fr', totalTickets: 0, totalParcels: 0, segments: [],
      });
      await service.byCustomer('T1', 'c1');

      const ticketCall = prismaMock.ticket.findMany.mock.calls[0][0];
      expect(ticketCall.where.status).toEqual({ notIn: ['CANCELLED', 'EXPIRED'] });
      expect(ticketCall.where.tenantId).toBe('T1');
    });

    it('marque isRecurrent si totalTickets + totalParcels >= 2', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', language: null, totalTickets: 1, totalParcels: 1, segments: [],
      });
      const rec = await service.byCustomer('T1', 'c1');
      expect(rec.isRecurrent).toBe(true);
    });

    it('topDestinationId pour les colis envoyés', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', language: null, totalTickets: 0, totalParcels: 2, segments: [],
      });
      prismaMock.parcel.findMany.mockResolvedValueOnce([
        { destinationId: 'dest-A' },
        { destinationId: 'dest-A' },
        { destinationId: 'dest-B' },
      ]);
      const rec = await service.byCustomer('T1', 'c1');
      expect(rec.topDestinationId).toBe('dest-A');
    });

    it('null sur tous les tops si pas d\'historique', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce({
        id: 'c1', language: null, totalTickets: 0, totalParcels: 0, segments: [],
      });
      const rec = await service.byCustomer('T1', 'c1');
      expect(rec.topSeat).toBeNull();
      expect(rec.topFareClass).toBeNull();
      expect(rec.topBoardingId).toBeNull();
      expect(rec.topAlightingId).toBeNull();
      expect(rec.topDestinationId).toBeNull();
    });
  });

  describe('byPhone()', () => {
    it('retourne null si phone invalide (pas d\'erreur)', async () => {
      const rec = await service.byPhone('T1', 'not-a-phone');
      expect(rec).toBeNull();
    });

    it('normalise le phone avant lookup (E.164)', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);
      await service.byPhone('T1', '06 12 34 56 78');

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'T1', phoneE164: '+242612345678' }),
        }),
      );
    });

    it('retourne null silencieusement si aucun Customer ne matche', async () => {
      prismaMock.customer.findFirst.mockResolvedValueOnce(null);
      const rec = await service.byPhone('T1', '+242612345678');
      expect(rec).toBeNull();
    });
  });
});
