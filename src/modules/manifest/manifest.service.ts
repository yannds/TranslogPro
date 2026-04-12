import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Inject } from '@nestjs/common';

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
        travelers: { include: { ticket: true } },
        parcels:   true,
        route:     true,
        bus:       true,
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    // In a full implementation, generate PDF via a PDF library (e.g. pdf-lib).
    // Here we return the manifest data and a presigned upload URL for the PDF.
    const key = `${tenantId}/manifests/${tripId}/${Date.now()}.pdf`;
    const uploadUrl = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    const manifest = await this.prisma.manifest.create({
      data: {
        tenantId,
        tripId,
        generatedById: actor.id,
        storageKey:    key,
        status:        'DRAFT',
        passengerCount: trip.travelers.length,
        parcelCount:    trip.parcels.length,
      },
    });

    return { manifest, uploadUrl };
  }

  async sign(tenantId: string, manifestId: string, actor: CurrentUserPayload) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} not found`);
    if (manifest.status === 'SIGNED') throw new BadRequestException('Manifest already signed');

    return this.prisma.manifest.update({
      where: { id: manifestId },
      data:  { status: 'SIGNED', signedById: actor.id, signedAt: new Date() },
    });
  }

  async getDownloadUrl(tenantId: string, manifestId: string) {
    const manifest = await this.prisma.manifest.findFirst({
      where: { id: manifestId, tenantId },
    });
    if (!manifest) throw new NotFoundException(`Manifest ${manifestId} not found`);

    return this.storage.getDownloadUrl(tenantId, manifest.storageKey, DocumentType.MAINTENANCE_DOC);
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.manifest.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
