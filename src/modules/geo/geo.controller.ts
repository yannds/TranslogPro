import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GeoService } from './geo.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

/**
 * Géocodage d'adresse — strategy multi-provider Google → Mapbox → Nominatim.
 * Utilisé par l'UI de création/edition de station (saisie adresse → coordonnées).
 * Rate-limité pour respecter l'usage policy Nominatim et borner le coût Google/Mapbox.
 * Les résultats sont filtrés par le pays du tenant (biais geographique).
 */
@Controller('tenants/:tenantId/geo')
export class GeoController {
  constructor(
    private readonly geo: GeoService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('search')
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    30,
    windowMs: 60_000,
    keyBy:    'userId',
    suffix:   'geo_search',
    message:  'Trop de recherches géo — réessayez dans une minute',
  })
  async search(@Param('tenantId') tenantId: string, @Query('q') q: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { country: true },
    });
    const results = await this.geo.search(q, tenant?.country);
    return { results };
  }

  /**
   * Reverse geocoding : coordonnees → adresse la plus proche.
   * Permet de confirmer "tu pointes bien sur la bonne rue" apres drag manuel
   * du marker sur la carte Leaflet.
   */
  @Get('reverse')
  @RequirePermission(Permission.STATION_MANAGE_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    60,
    windowMs: 60_000,
    keyBy:    'userId',
    suffix:   'geo_reverse',
    message:  'Trop de recherches reverse-geo — réessayez dans une minute',
  })
  async reverse(
    @Param('tenantId') tenantId: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      throw new BadRequestException('lat/lng must be numbers');
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { country: true },
    });
    const result = await this.geo.reverse(latNum, lngNum, tenant?.country);
    return { result };
  }
}
