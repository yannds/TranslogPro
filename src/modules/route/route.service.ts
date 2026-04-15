import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface CreateRouteDto {
  name:          string;
  originId:      string;
  destinationId: string;
  distanceKm:    number;
  basePrice:     number;
}

export interface UpdateRouteDto {
  name?:          string;
  originId?:      string;
  destinationId?: string;
  distanceKm?:    number;
  basePrice?:     number;
}

@Injectable()
export class RouteService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.route.findMany({
      where: { tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        _count:      { select: { trips: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
      },
    });
    if (!route) throw new NotFoundException(`Ligne ${id} introuvable dans ce tenant`);
    return route;
  }

  async create(tenantId: string, dto: CreateRouteDto) {
    const payload = this.validate(dto, /* partial */ false);
    await this.assertStationBelongsToTenant(tenantId, payload.originId!);
    await this.assertStationBelongsToTenant(tenantId, payload.destinationId!);
    if (payload.originId === payload.destinationId) {
      throw new BadRequestException('L\'origine et la destination doivent être différentes');
    }

    return this.prisma.route.create({
      data: {
        tenantId,
        name:          payload.name!,
        originId:      payload.originId!,
        destinationId: payload.destinationId!,
        distanceKm:    payload.distanceKm!,
        basePrice:     payload.basePrice!,
      },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        _count:      { select: { trips: true } },
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRouteDto) {
    const existing = await this.findOne(tenantId, id);
    const payload  = this.validate(dto, /* partial */ true);

    if (payload.originId      !== undefined) await this.assertStationBelongsToTenant(tenantId, payload.originId);
    if (payload.destinationId !== undefined) await this.assertStationBelongsToTenant(tenantId, payload.destinationId);

    const nextOrigin      = payload.originId      ?? existing.originId;
    const nextDestination = payload.destinationId ?? existing.destinationId;
    if (nextOrigin === nextDestination) {
      throw new BadRequestException('L\'origine et la destination doivent être différentes');
    }

    return this.prisma.route.update({
      where: { id },
      data: {
        ...(payload.name          !== undefined ? { name:          payload.name }          : {}),
        ...(payload.originId      !== undefined ? { originId:      payload.originId }      : {}),
        ...(payload.destinationId !== undefined ? { destinationId: payload.destinationId } : {}),
        ...(payload.distanceKm    !== undefined ? { distanceKm:    payload.distanceKm }    : {}),
        ...(payload.basePrice     !== undefined ? { basePrice:     payload.basePrice }     : {}),
      },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        _count:      { select: { trips: true } },
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const tripCount = await this.prisma.trip.count({ where: { tenantId, routeId: id } });
    if (tripCount > 0) {
      throw new ConflictException(
        `Impossible de supprimer cette ligne : ${tripCount} trajet(s) y sont rattachés. ` +
        'Annulez ou réaffectez les trajets avant de supprimer la ligne.',
      );
    }

    return this.prisma.transact(async (tx) => {
      await tx.waypoint.deleteMany({ where: { routeId: id } });
      await tx.route.delete({ where: { id } });
      return { deleted: true };
    });
  }

  listStations(tenantId: string) {
    return this.prisma.station.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, city: true, type: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
    });
  }

  private validate(dto: CreateRouteDto | UpdateRouteDto, partial: boolean) {
    const out: UpdateRouteDto = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Le nom de la ligne est requis');
      out.name = name;
    } else if (!partial) {
      throw new BadRequestException('Le nom de la ligne est requis');
    }

    if (dto.originId !== undefined) {
      if (!dto.originId.trim()) throw new BadRequestException('Station d\'origine requise');
      out.originId = dto.originId.trim();
    } else if (!partial) {
      throw new BadRequestException('Station d\'origine requise');
    }

    if (dto.destinationId !== undefined) {
      if (!dto.destinationId.trim()) throw new BadRequestException('Station de destination requise');
      out.destinationId = dto.destinationId.trim();
    } else if (!partial) {
      throw new BadRequestException('Station de destination requise');
    }

    if (dto.distanceKm !== undefined) {
      if (typeof dto.distanceKm !== 'number' || Number.isNaN(dto.distanceKm) || dto.distanceKm < 0) {
        throw new BadRequestException('La distance doit être un nombre positif');
      }
      out.distanceKm = dto.distanceKm;
    } else if (!partial) {
      throw new BadRequestException('La distance est requise');
    }

    if (dto.basePrice !== undefined) {
      if (typeof dto.basePrice !== 'number' || Number.isNaN(dto.basePrice) || dto.basePrice < 0) {
        throw new BadRequestException('Le tarif de base doit être un nombre positif');
      }
      out.basePrice = dto.basePrice;
    } else if (!partial) {
      throw new BadRequestException('Le tarif de base est requis');
    }

    return out;
  }

  private async assertStationBelongsToTenant(tenantId: string, stationId: string) {
    const station = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId },
      select: { id: true },
    });
    if (!station) {
      throw new BadRequestException(`Station ${stationId} introuvable dans ce tenant`);
    }
  }
}
