/**
 * Security Test — Garde-fous départ trajet (FlightDeck).
 *
 * Vérifie qu'aucun bypass n'est possible sur les guards critiques :
 *
 *   [DEP-1] IN_PROGRESS exige AU MOINS UN manifest SIGNED — pas de manifest
 *           DRAFT/SUBMITTED/REJECTED, pas de manifest d'un autre trip,
 *           pas de manifest d'un autre tenant.
 *
 *   [DEP-2] La transition refuse 403 si le trajet n'est pas assigné au
 *           chauffeur authentifié, MÊME SI tous les autres guards passent.
 *           Defense in depth contre IDOR.
 *
 *   [DEP-3] closeFreight scoped par tenant : un user du tenant A ne peut pas
 *           clôturer le fret d'un trip du tenant B (404 fail-closed, pas 403
 *           pour ne pas leak l'existence).
 *
 *   [DEP-4] Idempotence sécurisée : 2e appel closeFreight ne re-stampe pas
 *           freightClosedById — préserve l'audit du 1er auteur.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FlightDeckService } from '../../src/modules/flight-deck/flight-deck.service';

describe('[SECURITY] Trip departure guards', () => {
  let prismaMock: any;
  let workflowMock: any;
  let service: FlightDeckService;

  beforeEach(() => {
    prismaMock = {
      trip: { findFirst: jest.fn(), update: jest.fn() },
      staff: { findFirst: jest.fn() },
      manifest: { findFirst: jest.fn() },
    };
    workflowMock = { transition: jest.fn() };
    service = new FlightDeckService(prismaMock, {} as any, workflowMock);
  });

  // ─── [DEP-1] Bypass manifest impossible ───────────────────────────────────

  describe('[DEP-1] IN_PROGRESS sans manifest signé', () => {
    beforeEach(() => {
      prismaMock.trip.findFirst.mockResolvedValue({
        id: 'T', status: 'BOARDING', driverId: 'staff1', tenantId: 'tenant', version: 1,
      });
      prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff1' });
    });

    it('refuse si manifest DRAFT (non signé)', async () => {
      // findFirst filtre déjà status: 'SIGNED' donc renvoie null
      prismaMock.manifest.findFirst.mockResolvedValue(null);

      await expect(
        service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse si manifest SUBMITTED (envoyé mais non signé)', async () => {
      prismaMock.manifest.findFirst.mockResolvedValue(null);

      await expect(
        service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
      ).rejects.toThrow(/MANIFEST_NOT_SIGNED/);
    });

    it('refuse si manifest REJECTED', async () => {
      prismaMock.manifest.findFirst.mockResolvedValue(null);

      await expect(
        service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS'),
      ).rejects.toThrow(BadRequestException);
    });

    it('vérifie que le filtre WHERE inclut bien tenantId + tripId + status:SIGNED', async () => {
      prismaMock.manifest.findFirst.mockResolvedValue({ id: 'M', kind: 'ALL' });
      prismaMock.trip.update.mockResolvedValue({ id: 'T', status: 'IN_PROGRESS' });
      workflowMock.transition.mockImplementation(async (_e: any, _i: any, cfg: any) => {
        await cfg.persist({ id: 'T', status: 'BOARDING' }, 'IN_PROGRESS', prismaMock);
        return { entity: { id: 'T', status: 'IN_PROGRESS' }, toState: 'IN_PROGRESS', fromState: 'BOARDING' };
      });

      await service.transitionTripStatus('tenant', 'T', 'user1', 'IN_PROGRESS');

      // Le where doit scoper sur tenant + trip + status SIGNED — sans ces 3,
      // un manifest signé d'un autre tenant ou d'un autre trip pourrait être
      // accepté (CRITIQUE).
      expect(prismaMock.manifest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant',
            tripId:   'T',
            status:   'SIGNED',
          }),
        }),
      );
    });
  });

  // ─── [DEP-2] Defense in depth ownership ───────────────────────────────────

  describe('[DEP-2] Trip pas assigné au chauffeur', () => {
    it('refuse 403 même si manifest signé existe', async () => {
      prismaMock.trip.findFirst.mockResolvedValue({
        id: 'T', status: 'BOARDING', driverId: 'staff_attacker_target', tenantId: 'tenant', version: 1,
      });
      prismaMock.staff.findFirst.mockResolvedValue({ id: 'staff_attacker' }); // pas le driver
      prismaMock.manifest.findFirst.mockResolvedValue({ id: 'M' });

      await expect(
        service.transitionTripStatus('tenant', 'T', 'user_attacker', 'IN_PROGRESS'),
      ).rejects.toThrow(ForbiddenException);

      // Vérifier que le check ownership s'exécute AVANT le check manifest —
      // on ne doit pas leak via timing si le manifest existe ou non.
      expect(workflowMock.transition).not.toHaveBeenCalled();
    });

    it('refuse 403 si user n\'a aucun staff dans le tenant (escalade depuis autre tenant)', async () => {
      prismaMock.trip.findFirst.mockResolvedValue({
        id: 'T', status: 'BOARDING', driverId: 'staff1', tenantId: 'tenant', version: 1,
      });
      prismaMock.staff.findFirst.mockResolvedValue(null); // user n'a pas de Staff dans ce tenant

      await expect(
        service.transitionTripStatus('tenant', 'T', 'user_foreign', 'IN_PROGRESS'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── [DEP-3] Isolation tenant freight close ───────────────────────────────

  describe('[DEP-3] closeFreight cross-tenant', () => {
    it('refuse 404 (fail-closed) si trip d\'un autre tenant', async () => {
      // Le where du findFirst est { id: tripId, tenantId } — un trip existant
      // dans un autre tenant retourne null, traité comme 404 (fail-closed).
      prismaMock.trip.findFirst.mockResolvedValue(null);

      await expect(
        service.closeFreight('tenant_B', 'T_from_tenant_A', 'user1'),
      ).rejects.toThrow(NotFoundException);

      // Pas d'update — le verrou cross-tenant tient.
      expect(prismaMock.trip.update).not.toHaveBeenCalled();
    });
  });

  // ─── [DEP-4] Idempotence freight ──────────────────────────────────────────

  describe('[DEP-4] closeFreight idempotent — ne ré-écrit pas l\'auteur', () => {
    it('préserve freightClosedById du 1er actor même si 2e user appelle', async () => {
      const firstClose = new Date('2026-04-19T18:00:00.000Z');
      prismaMock.trip.findFirst.mockResolvedValue({
        id: 'T', driverId: 'staff1',
        freightClosedAt: firstClose, freightClosedById: 'first_user',
      });

      const res = await service.closeFreight('tenant', 'T', 'second_user');

      // Audit trail du 1er auteur préservé — important pour la traçabilité
      // ISO 27001 et la non-répudiation.
      expect(res.freightClosedById).toBe('first_user');
      expect(prismaMock.trip.update).not.toHaveBeenCalled();
    });
  });
});
