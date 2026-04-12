import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(tenantId: string, agencyId?: string) {
    const agencyFilter = agencyId ? { agencyId } : {};

    const [
      totalTrips,
      activeTrips,
      totalTickets,
      totalRevenue,
      totalParcels,
      openIncidents,
    ] = await Promise.all([
      this.prisma.trip.count({ where: { tenantId, ...agencyFilter } }),
      this.prisma.trip.count({
        where: { tenantId, ...agencyFilter, status: { in: ['BOARDING', 'IN_PROGRESS'] } },
      }),
      this.prisma.ticket.count({ where: { tenantId } }),
      this.prisma.transaction.aggregate({
        where: { tenantId },
        _sum:  { amount: true },
      }),
      this.prisma.parcel.count({ where: { tenantId } }),
      this.prisma.incident.count({ where: { tenantId, status: { in: ['OPEN', 'ASSIGNED'] } } }),
    ]);

    return {
      trips:     { total: totalTrips, active: activeTrips },
      tickets:   { total: totalTickets },
      revenue:   { total: totalRevenue._sum.amount ?? 0, currency: 'XOF' },
      parcels:   { total: totalParcels },
      incidents: { open: openIncidents },
    };
  }

  async getTripsReport(
    tenantId: string,
    from:     Date,
    to:       Date,
    agencyId?: string,
  ) {
    return this.prisma.trip.groupBy({
      by:     ['status'],
      where:  {
        tenantId,
        departureScheduled: { gte: from, lte: to },
      },
      _count: { _all: true },
    });
  }

  async getRevenueReport(tenantId: string, from: Date, to: Date) {
    return this.prisma.transaction.groupBy({
      by:     ['type'],
      where:  { tenantId, createdAt: { gte: from, lte: to } },
      _sum:   { amount: true },
      _count: { _all: true },
    });
  }

  async getOccupancyRate(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id: tripId, tenantId },
      include: { bus: true, travelers: true },
    });
    if (!trip) return null;

    const capacity = trip.bus.capacity;
    const boarded  = trip.travelers.filter(t => t.status === 'BOARDED').length;

    return {
      tripId,
      capacity,
      boarded,
      occupancyRate: capacity > 0 ? Math.round((boarded / capacity) * 100) : 0,
    };
  }
}
