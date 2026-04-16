import {
  Injectable, NotFoundException, ConflictException, BadRequestException, Inject,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { CreateBusDto } from './dto/create-bus.dto';
import { UpdateBusDto } from './dto/update-bus.dto';
import {
  IStorageService, STORAGE_SERVICE, DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';
import { v4 as uuidv4 } from 'uuid';

const ACTIVE_TRIP_STATUSES = [
  'PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS',
  'IN_PROGRESS_PAUSED', 'IN_PROGRESS_DELAYED',
];

const ALLOWED_PHOTO_EXT = ['jpg', 'jpeg', 'png', 'webp'];

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async createBus(tenantId: string, dto: CreateBusDto) {
    return this.prisma.bus.create({
      data: {
        tenantId,
        agencyId:            dto.agencyId,
        plateNumber:         dto.plateNumber,
        model:               dto.model ?? '',
        type:                dto.type,
        year:                dto.year,
        capacity:            dto.capacity,
        luggageCapacityKg:   dto.luggageCapacityKg ?? 0,
        luggageCapacityM3:   dto.luggageCapacityM3 ?? 0,
        vin:                 dto.vin,
        fuelType:            dto.fuelType,
        engineType:          dto.engineType,
        fuelTankCapacityL:   dto.fuelTankCapacityL,
        adBlueTankCapacityL: dto.adBlueTankCapacityL,
        registrationDate:    dto.registrationDate ? new Date(dto.registrationDate) : undefined,
        purchaseDate:        dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        purchasePrice:       dto.purchasePrice,
        initialOdometerKm:         dto.initialOdometerKm,
        currentOdometerKm:         dto.initialOdometerKm,
        fuelConsumptionPer100Km:   dto.fuelConsumptionPer100Km,
        adBlueConsumptionPer100Km: dto.adBlueConsumptionPer100Km,
      },
    });
  }

  async updateBus(tenantId: string, id: string, dto: UpdateBusDto) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({
      where: { id },
      data: {
        plateNumber:         dto.plateNumber,
        model:               dto.model,
        type:                dto.type,
        year:                dto.year,
        capacity:            dto.capacity,
        agencyId:            dto.agencyId,
        luggageCapacityKg:   dto.luggageCapacityKg,
        luggageCapacityM3:   dto.luggageCapacityM3,
        vin:                 dto.vin,
        fuelType:            dto.fuelType,
        engineType:          dto.engineType,
        fuelTankCapacityL:   dto.fuelTankCapacityL,
        adBlueTankCapacityL: dto.adBlueTankCapacityL,
        registrationDate:    dto.registrationDate ? new Date(dto.registrationDate) : undefined,
        purchaseDate:        dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        purchasePrice:             dto.purchasePrice,
        initialOdometerKm:         dto.initialOdometerKm,
        fuelConsumptionPer100Km:   dto.fuelConsumptionPer100Km,
        adBlueConsumptionPer100Km: dto.adBlueConsumptionPer100Km,
      },
    });
  }

  async deleteBus(tenantId: string, id: string) {
    const bus = await this.findOne(tenantId, id);
    const activeTrips = await this.prisma.trip.count({
      where: { busId: id, tenantId, status: { in: ACTIVE_TRIP_STATUSES } },
    });
    if (activeTrips > 0) {
      throw new ConflictException(
        `Impossible de supprimer : ${activeTrips} voyage(s) actif(s) référencent ce véhicule.`,
      );
    }
    // Best-effort : nettoyer les photos S3
    for (const key of bus.photos ?? []) {
      try { await this.storage.deleteObject(tenantId, key); } catch { /* swallow */ }
    }
    await this.prisma.bus.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * PRD §IV.3 — seatLayout obligatoire avant toute vente numérotée.
   */
  async setSeatLayout(tenantId: string, id: string, seatLayout: Record<string, unknown>) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data:  { seatLayout: seatLayout as any },
    });
  }

  async findAll(tenantId: string, _scope: ScopeContext) {
    return this.prisma.bus.findMany({
      where:   { tenantId },
      orderBy: { plateNumber: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const bus = await this.prisma.bus.findFirst({ where: { id, tenantId } });
    if (!bus) throw new NotFoundException(`Bus ${id} introuvable`);
    return bus;
  }

  async updateStatus(tenantId: string, id: string, status: string, _scope: ScopeContext) {
    await this.findOne(tenantId, id);
    return this.prisma.bus.update({ where: { id }, data: { status } });
  }

  // ─── Photos ─────────────────────────────────────────────────────────────────

  /**
   * Étape 1 — le client demande une URL d'upload présignée pour une photo.
   * Le `fileKey` n'est PAS encore ajouté au bus : il faut appeler `addPhoto`
   * une fois l'upload PUT réussi (workflow en 2 étapes pour éviter les fantômes).
   */
  async requestPhotoUpload(tenantId: string, busId: string, ext: string) {
    await this.findOne(tenantId, busId);
    const e = ext.toLowerCase().replace(/^\./, '');
    if (!ALLOWED_PHOTO_EXT.includes(e)) {
      throw new BadRequestException(
        `Extension photo invalide. Autorisées : ${ALLOWED_PHOTO_EXT.join(', ')}`,
      );
    }
    const key    = `${tenantId}/fleet/buses/${busId}/photos/${uuidv4()}.${e}`;
    const signed = await this.storage.getUploadUrl(tenantId, key, DocumentType.BUS_PHOTO);
    return { uploadUrl: signed.url, fileKey: key, expiresAt: signed.expiresAt };
  }

  /** Étape 2 — confirme l'upload : ajoute la clé à la liste des photos. */
  async addPhoto(tenantId: string, busId: string, fileKey: string) {
    const bus = await this.findOne(tenantId, busId);
    if (!this.storage.assertObjectBelongsToTenant(tenantId, fileKey)) {
      throw new BadRequestException('fileKey hors tenant');
    }
    const expectedPrefix = `${tenantId}/fleet/buses/${busId}/photos/`;
    if (!fileKey.startsWith(expectedPrefix)) {
      throw new BadRequestException('fileKey ne correspond pas à ce bus');
    }
    if (bus.photos.includes(fileKey)) return bus;
    return this.prisma.bus.update({
      where: { id: busId },
      data:  { photos: { set: [...bus.photos, fileKey] } },
    });
  }

  async removePhoto(tenantId: string, busId: string, fileKey: string) {
    const bus = await this.findOne(tenantId, busId);
    if (!bus.photos.includes(fileKey)) {
      throw new NotFoundException('Photo introuvable sur ce véhicule');
    }
    try { await this.storage.deleteObject(tenantId, fileKey); } catch { /* swallow */ }
    return this.prisma.bus.update({
      where: { id: busId },
      data:  { photos: { set: bus.photos.filter(k => k !== fileKey) } },
    });
  }

  /** Retourne les URLs présignées de téléchargement pour chaque photo (24h). */
  async getPhotosWithUrls(tenantId: string, busId: string) {
    const bus = await this.findOne(tenantId, busId);
    const items = await Promise.all(
      bus.photos.map(async key => {
        const u = await this.storage.getDownloadUrl(tenantId, key, DocumentType.BUS_PHOTO);
        return { fileKey: key, url: u.url, expiresAt: u.expiresAt };
      }),
    );
    return items;
  }

  async getDisplayInfo(tenantId: string, busId: string) {
    const bus = await this.prisma.bus.findFirst({
      where:   { id: busId, tenantId },
      include: {
        trips: {
          where:   { status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS'] } },
          orderBy: { departureScheduled: 'asc' },
          take:    1,
          include: { route: true },
        },
      },
    });
    if (!bus) throw new NotFoundException(`Bus ${busId} introuvable`);
    return bus;
  }
}
