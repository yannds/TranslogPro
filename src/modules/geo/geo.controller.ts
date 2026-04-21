import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GeoService } from './geo.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

/**
 * Géocodage d'adresse — proxy Nominatim (OSM).
 * Utilisé par l'UI de création de station (saisie adresse → coordonnées).
 * Rate-limité pour respecter l'usage policy OSM (≤1 req/s global serveur).
 * Les résultats sont filtrés par le pays du tenant (countrycodes Nominatim).
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
}
