import { ForbiddenException } from '@nestjs/common';
import { ownershipWhere, assertOwnership } from '../../../src/common/helpers/scope-filter';
import type { ScopeContext } from '../../../src/common/decorators/scope-context.decorator';

const baseScope = (overrides: Partial<ScopeContext>): ScopeContext => ({
  scope:           'tenant',
  tenantId:        'tenant-001',
  userId:          'user-001',
  agencyId:        'agency-001',
  isImpersonating: false,
  actorTenantId:   'tenant-001',
  ...overrides,
});

describe('scope-filter', () => {
  // ─── ownershipWhere ────────────────────────────────────────────────────────
  describe('ownershipWhere()', () => {
    it("scope='own' → filtre {ownerField: userId}", () => {
      const where = ownershipWhere(baseScope({ scope: 'own' }), 'driverId');
      expect(where).toEqual({ driverId: 'user-001' });
    });

    it("scope='agency' → filtre {agencyId}", () => {
      const where = ownershipWhere(baseScope({ scope: 'agency' }), 'driverId');
      expect(where).toEqual({ agencyId: 'agency-001' });
    });

    it("scope='tenant' → aucun filtre additionnel", () => {
      const where = ownershipWhere(baseScope({ scope: 'tenant' }), 'driverId');
      expect(where).toEqual({});
    });

    it("scope='global' → aucun filtre additionnel", () => {
      const where = ownershipWhere(baseScope({ scope: 'global' }), 'driverId');
      expect(where).toEqual({});
    });

    it("scope='agency' sans agencyId → sentinelle '__none__' (aucun match)", () => {
      const where = ownershipWhere(baseScope({ scope: 'agency', agencyId: undefined }), 'driverId');
      // Évite un filtre vide qui retournerait toutes les rows.
      expect(where).toEqual({ agencyId: '__none__' });
    });

    it('respecte le ownerField passé en argument', () => {
      expect(ownershipWhere(baseScope({ scope: 'own' }), 'passengerId'))
        .toEqual({ passengerId: 'user-001' });
      expect(ownershipWhere(baseScope({ scope: 'own' }), 'senderId'))
        .toEqual({ senderId: 'user-001' });
    });
  });

  // ─── assertOwnership ───────────────────────────────────────────────────────
  describe('assertOwnership()', () => {
    it("scope='own' + ressource possédée → no-op", () => {
      const trip = { id: 'trip-001', driverId: 'user-001' };
      expect(() =>
        assertOwnership(baseScope({ scope: 'own' }), trip, 'driverId'),
      ).not.toThrow();
    });

    it("scope='own' + ressource non possédée → ForbiddenException", () => {
      const trip = { id: 'trip-001', driverId: 'autre-user' };
      expect(() =>
        assertOwnership(baseScope({ scope: 'own' }), trip, 'driverId'),
      ).toThrow(ForbiddenException);
    });

    it("scope='tenant' → no-op même si ressource étrangère", () => {
      const trip = { id: 'trip-001', driverId: 'autre-user' };
      expect(() =>
        assertOwnership(baseScope({ scope: 'tenant' }), trip, 'driverId'),
      ).not.toThrow();
    });

    it("scope='agency' → no-op (filtrage agency déjà appliqué upstream)", () => {
      const trip = { id: 'trip-001', driverId: 'autre-user' };
      expect(() =>
        assertOwnership(baseScope({ scope: 'agency' }), trip, 'driverId'),
      ).not.toThrow();
    });

    it('ressource null/undefined → no-op (laisse 404 upstream)', () => {
      expect(() =>
        assertOwnership(baseScope({ scope: 'own' }), null, 'driverId'),
      ).not.toThrow();
      expect(() =>
        assertOwnership(baseScope({ scope: 'own' }), undefined, 'driverId'),
      ).not.toThrow();
    });
  });
});
