import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Public REST endpoints for display screens (departure boards, kiosks).
 * No authentication required — tenantId comes from the URL path.
 * RlsMiddleware recognises these routes via PUBLIC_TENANT_PATHS.
 */
@Controller('tenants/:tenantId')
export class DisplayController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('stations/:stationId/display')
  async stationDisplay(
    @Param('tenantId') tenantId: string,
    @Param('stationId') stationId: string,
  ) {
    return this.prisma.trip.findMany({
      where: {
        tenantId,
        status:   { in: ['PLANNED', 'BOARDING', 'IN_PROGRESS'] },
        route:    { OR: [{ originId: stationId }, { destinationId: stationId }] },
        departureScheduled: { gte: new Date() },
      },
      include: { route: true, bus: true },
      orderBy: { departureScheduled: 'asc' },
      take:    20,
    });
  }

  @Get('buses/:busId/display')
  async busDisplay(
    @Param('tenantId') tenantId: string,
    @Param('busId') busId: string,
  ) {
    return this.prisma.bus.findFirst({
      where:   { id: busId, tenantId },
      include: {
        trips: {
          where:   { status: { in: ['PLANNED', 'BOARDING', 'IN_PROGRESS'] } },
          orderBy: { departureScheduled: 'asc' },
          take:    1,
          include: { route: true },
        },
      },
    });
  }

  @Get('parcels/track/:code')
  async trackParcel(
    @Param('tenantId') tenantId: string,
    @Param('code') code: string,
  ) {
    return this.prisma.parcel.findFirst({
      where:   { tenantId, trackingCode: code },
      select:  {
        trackingCode: true, status: true,
        destination:  { select: { name: true } },
        createdAt:    true,
      },
    });
  }
}
