import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { GeoService } from '../geo/geo.service';
import type { GeoSearchResult } from '../geo/providers/geo-provider.interface';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo:    GeoService,
  ) {}

  /**
   * Suggere de nouvelles coordonnees pour une station existante en re-geocodant
   * son nom + ville via la chaine multi-provider (Google → Mapbox → Nominatim).
   * NE SAUVE PAS — retourne une suggestion que l'admin valide via PATCH /stations/:id.
   *
   * Sert principalement a corriger en lot les pins faux poses par Nominatim/OSM
   * en Afrique francophone avant l'introduction de Google Geocoding.
   */
  async regeocode(tenantId: string, stationId: string): Promise<{
    current:  { lat: number; lng: number } | null;
    suggested: GeoSearchResult | null;
    distanceKmFromCurrent: number | null;
  }> {
    const station = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId },
      select: { name: true, city: true, coordinates: true, tenant: { select: { country: true } } },
    });
    if (!station) throw new NotFoundException('Station introuvable');

    const query = [station.name, station.city].filter(Boolean).join(', ').trim();
    if (query.length < 3) throw new BadRequestException('Nom/ville insuffisants pour re-geocoder');

    const results = await this.geo.search(query, station.tenant?.country ?? undefined);
    const suggested = results[0] ?? null;

    const coords = station.coordinates as { lat?: number; lng?: number } | null;
    const current = coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
      ? { lat: coords.lat as number, lng: coords.lng as number }
      : null;

    let distanceKmFromCurrent: number | null = null;
    if (current && suggested) {
      distanceKmFromCurrent = haversineKm(current.lat, current.lng, suggested.lat, suggested.lng);
    }

    return { current, suggested, distanceKmFromCurrent };
  }

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

/** Distance approximative entre 2 points GPS (formule haversine, km). */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}
