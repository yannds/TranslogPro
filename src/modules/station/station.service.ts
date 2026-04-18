import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export type StationType = 'PRINCIPALE' | 'RELAIS';
const STATION_TYPES: readonly StationType[] = ['PRINCIPALE', 'RELAIS'];

export interface StationCoordinates {
  lat: number;
  lng: number;
  [key: string]: number;
}

export interface CreateStationDto {
  name:        string;
  city:        string;
  type:        StationType;
  coordinates: StationCoordinates;
}

export interface UpdateStationDto {
  name?:        string;
  city?:        string;
  type?:        StationType;
  coordinates?: StationCoordinates;
}

/**
 * CRUD des stations (gares routières) du tenant.
 * Source des origines/destinations pour lignes, colis, voyageurs.
 * Suppression refusée (409) si la station est référencée.
 */
@Injectable()
export class StationService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.station.findMany({
      where:   { tenantId },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            routesOrigin:      true,
            routesDestination: true,
            agencies:          true,
            waypoints:         true,
            parcelsTo:         true,
            shipmentsTo:       true,
            travelersDropoff:  true,
          },
        },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const station = await this.prisma.station.findFirst({
      where: { id, tenantId },
    });
    if (!station) throw new NotFoundException(`Station ${id} introuvable dans ce tenant`);
    return station;
  }

  async create(tenantId: string, dto: CreateStationDto) {
    const payload = this.validate(dto, /* partial */ false);
    return this.prisma.station.create({
      data: {
        tenantId,
        name:        payload.name!,
        city:        payload.city!,
        type:        payload.type!,
        coordinates: payload.coordinates!,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateStationDto) {
    await this.findOne(tenantId, id);
    const payload = this.validate(dto, /* partial */ true);

    const res = await this.prisma.station.updateMany({
      where: { id, tenantId },
      data: {
        ...(payload.name        !== undefined ? { name:        payload.name }        : {}),
        ...(payload.city        !== undefined ? { city:        payload.city }        : {}),
        ...(payload.type        !== undefined ? { type:        payload.type }        : {}),
        ...(payload.coordinates !== undefined ? { coordinates: payload.coordinates } : {}),
      },
    });
    if (res.count === 0) throw new NotFoundException(`Station ${id} introuvable`);
    return this.findOne(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const [routesO, routesD, waypoints, agencies, parcels, shipments, travelers] =
      await Promise.all([
        this.prisma.route.count({ where:    { originId:      id } }),
        this.prisma.route.count({ where:    { destinationId: id } }),
        this.prisma.waypoint.count({ where: { stationId:     id } }),
        this.prisma.agency.count({ where:   { tenantId, stationId: id } }),
        this.prisma.parcel.count({ where:   { tenantId, destinationId: id } }),
        this.prisma.shipment.count({ where: { tenantId, destinationId: id } }),
        this.prisma.traveler.count({ where: { tenantId, dropOffStationId: id } }),
      ]);

    const refs =
      routesO + routesD + waypoints + agencies + parcels + shipments + travelers;
    if (refs > 0) {
      throw new ConflictException(
        `Impossible de supprimer cette station : elle est référencée par ${refs} objet(s) ` +
        '(lignes, agences, colis, voyageurs). Réaffectez-les avant suppression.',
      );
    }

    const res = await this.prisma.station.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Station ${id} introuvable`);
    return { deleted: true };
  }

  private validate(dto: CreateStationDto | UpdateStationDto, partial: boolean) {
    const out: UpdateStationDto = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Le nom de la station est requis');
      out.name = name;
    } else if (!partial) {
      throw new BadRequestException('Le nom de la station est requis');
    }

    if (dto.city !== undefined) {
      const city = dto.city.trim();
      if (!city) throw new BadRequestException('La ville est requise');
      out.city = city;
    } else if (!partial) {
      throw new BadRequestException('La ville est requise');
    }

    if (dto.type !== undefined) {
      if (!STATION_TYPES.includes(dto.type)) {
        throw new BadRequestException(
          `Type de station invalide (attendu : ${STATION_TYPES.join(' | ')})`,
        );
      }
      out.type = dto.type;
    } else if (!partial) {
      throw new BadRequestException('Le type de station est requis');
    }

    if (dto.coordinates !== undefined) {
      const c = dto.coordinates;
      if (
        !c ||
        typeof c.lat !== 'number' || Number.isNaN(c.lat) || c.lat < -90  || c.lat > 90 ||
        typeof c.lng !== 'number' || Number.isNaN(c.lng) || c.lng < -180 || c.lng > 180
      ) {
        throw new BadRequestException('Coordonnées invalides (lat ∈ [-90,90], lng ∈ [-180,180])');
      }
      out.coordinates = { lat: c.lat, lng: c.lng };
    } else if (!partial) {
      throw new BadRequestException('Les coordonnées sont requises');
    }

    return out;
  }
}
