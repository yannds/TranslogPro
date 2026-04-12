/**
 * ManifestService — Tests unitaires
 *
 * Ce qui est testé :
 *   - generate() : NotFoundException si trip absent,
 *                  calcul parcelCount depuis shipments,
 *                  clé de stockage bien formée,
 *                  retour uploadUrl depuis IStorageService
 *   - sign()     : retour immédiat avec status=SIGNED (pas de table Manifest)
 *   - getDownloadUrl() : délégation IStorageService
 *   - findByTrip()     : retourne [] (pas de persistance)
 *
 * Mock : PrismaService, IStorageService
 */

import { NotFoundException } from '@nestjs/common';
import { ManifestService } from '@modules/manifest/manifest.service';
import { PrismaService } from '@infra/database/prisma.service';
import { IStorageService, DocumentType } from '@infra/storage/interfaces/storage.interface';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'tenant-manifest-001';
const ACTOR  = { id: 'agent-01', tenantId: TENANT, roleId: 'role-agent', agencyId: 'agency-01', roleName: 'Agent' };

const TRIP_WITH_MANIFEST = {
  id:        'trip-001',
  tenantId:  TENANT,
  travelers: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
  shipments: [
    { parcels: [{ id: 'p1' }, { id: 'p2' }] },
    { parcels: [{ id: 'p3' }] },
  ],
  route: { id: 'r1', name: 'Dakar-Thiès' },
  bus:   { id: 'b1', plate: 'DK-001' },
};

// ─── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(trip = TRIP_WITH_MANIFEST): jest.Mocked<PrismaService> {
  return {
    trip: {
      findFirst: jest.fn().mockResolvedValue(trip),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

function makeStorage(): jest.Mocked<IStorageService> {
  return {
    getUploadUrl:   jest.fn().mockResolvedValue('https://minio.local/upload-url'),
    getDownloadUrl: jest.fn().mockResolvedValue('https://minio.local/download-url'),
    deleteObject:   jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<IStorageService>;
}

function buildService(overrides: Partial<{
  prisma:   ReturnType<typeof makePrisma>;
  storage:  ReturnType<typeof makeStorage>;
}> = {}) {
  const prisma  = overrides.prisma   ?? makePrisma();
  const storage = overrides.storage  ?? makeStorage();
  return { service: new ManifestService(prisma, storage), prisma, storage };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ManifestService', () => {

  // ── generate() ─────────────────────────────────────────────────────────────

  describe('generate()', () => {
    it('retourne passengerCount=3 et parcelCount=3 pour le fixture', async () => {
      const { service } = buildService();
      const result = await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(result.passengerCount).toBe(3);
      expect(result.parcelCount).toBe(3);   // 2 + 1
    });

    it('retourne status=DRAFT et le tripId', async () => {
      const { service } = buildService();
      const result = await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(result.status).toBe('DRAFT');
      expect(result.tripId).toBe('trip-001');
      expect(result.generatedById).toBe(ACTOR.id);
    });

    it('la storageKey est au format tenantId/manifests/tripId/timestamp.pdf', async () => {
      const { service } = buildService();
      const result = await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(result.storageKey).toMatch(
        new RegExp(`^${TENANT}/manifests/trip-001/\\d+\\.pdf$`),
      );
    });

    it('appelle IStorageService.getUploadUrl avec le bon tenantId', async () => {
      const { service, storage } = buildService();
      await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(storage.getUploadUrl).toHaveBeenCalledWith(
        TENANT,
        expect.stringContaining('trip-001'),
        DocumentType.MAINTENANCE_DOC,
      );
    });

    it('retourne l\'uploadUrl fournie par le storage', async () => {
      const { service } = buildService();
      const result = await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(result.uploadUrl).toBe('https://minio.local/upload-url');
    });

    it('lève NotFoundException si le trip n\'existe pas', async () => {
      const prisma = makePrisma();
      prisma.trip.findFirst = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ prisma });
      await expect(service.generate(TENANT, 'absent', ACTOR as any)).rejects.toThrow(NotFoundException);
    });

    it('parcelCount=0 si aucun shipment', async () => {
      const tripSansShipments = { ...TRIP_WITH_MANIFEST, shipments: [] };
      const { service } = buildService({ prisma: makePrisma(tripSansShipments) });
      const result = await service.generate(TENANT, 'trip-001', ACTOR as any);
      expect(result.parcelCount).toBe(0);
    });
  });

  // ── sign() ─────────────────────────────────────────────────────────────────

  describe('sign()', () => {
    it('retourne status=SIGNED avec signedById et signedAt', async () => {
      const { service } = buildService();
      const result = await service.sign(TENANT, 'tenant/manifests/trip-001/123.pdf', ACTOR as any);
      expect(result.status).toBe('SIGNED');
      expect(result.signedById).toBe(ACTOR.id);
      expect(result.signedAt).toBeInstanceOf(Date);
      expect(result.storageKey).toBe('tenant/manifests/trip-001/123.pdf');
    });
  });

  // ── getDownloadUrl() ───────────────────────────────────────────────────────

  describe('getDownloadUrl()', () => {
    it('délègue à IStorageService.getDownloadUrl', async () => {
      const { service, storage } = buildService();
      const url = await service.getDownloadUrl(TENANT, 'some/key.pdf');
      expect(storage.getDownloadUrl).toHaveBeenCalledWith(TENANT, 'some/key.pdf', DocumentType.MAINTENANCE_DOC);
      expect(url).toBe('https://minio.local/download-url');
    });
  });

  // ── findByTrip() ───────────────────────────────────────────────────────────

  describe('findByTrip()', () => {
    it('retourne un tableau vide (pas de table Manifest)', async () => {
      const { service } = buildService();
      const result = await service.findByTrip(TENANT, 'trip-001');
      expect(result).toEqual([]);
    });
  });
});
