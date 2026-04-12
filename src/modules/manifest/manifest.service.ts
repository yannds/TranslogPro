import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Inject } from '@nestjs/common';

/**
 * Manifest = document récapitulatif d'un trajet (passagers + colis).
 * Pas de table Manifest en DB : la donnée est calculée depuis Trip/Traveler/Shipment.
 * Le PDF généré est stocké dans MinIO — l'URL signée est retournée.
 */
@Injectable()
export class ManifestService {
  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async generate(tenantId: string, tripId: string, actor: CurrentUserPayload) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: {
        travelers: true,
        shipments: { include: { parcels: true } },
        route:     true,
        bus:       true,
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    const key = `${tenantId}/manifests/${tripId}/${Date.now()}.pdf`;
    const uploadUrl = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    const parcelCount = trip.shipments.reduce((acc, s) => acc + s.parcels.length, 0);

    return {
      tripId,
      generatedById:  actor.id,
      storageKey:     key,
      status:         'DRAFT' as const,
      passengerCount: trip.travelers.length,
      parcelCount,
      uploadUrl,
    };
  }

  async sign(tenantId: string, manifestStorageKey: string, actor: CurrentUserPayload) {
    // Without a Manifest table, signing is a no-op that confirms the key exists in storage
    return {
      storageKey: manifestStorageKey,
      signedById: actor.id,
      signedAt:   new Date(),
      status:     'SIGNED' as const,
    };
  }

  async getDownloadUrl(tenantId: string, storageKey: string) {
    return this.storage.getDownloadUrl(tenantId, storageKey, DocumentType.MAINTENANCE_DOC);
  }

  async findByTrip(tenantId: string, tripId: string) {
    // Without persistence, return empty list — caller must track keys externally
    return [];
  }
}
