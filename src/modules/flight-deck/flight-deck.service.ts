import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TripState } from '../../common/constants/workflow-states';

/**
 * Flight-deck = Driver dashboard.
 * Provides the driver's view of their active trip, passenger list,
 * checklist items, and incident reporting.
 */
@Injectable()
export class FlightDeckService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveTripForDriver(tenantId: string, driverId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId,
        status: { in: [TripState.BOARDING, TripState.IN_PROGRESS, TripState.IN_PROGRESS_PAUSED, TripState.IN_PROGRESS_DELAYED] },
      },
      include: {
        route:     true,
        bus:       true,
        travelers: true,
        parcels:   { select: { id: true, trackingCode: true, recipientName: true, status: true } },
      },
    });

    if (!trip) return null;
    return trip;
  }

  async getChecklist(tenantId: string, tripId: string) {
    return this.prisma.checklistItem.findMany({
      where:   { tenantId, tripId },
      orderBy: { order: 'asc' },
    });
  }

  async checkItem(tenantId: string, itemId: string, driverId: string) {
    const item = await this.prisma.checklistItem.findFirst({
      where: { id: itemId, tenantId },
    });
    if (!item) throw new NotFoundException(`Checklist item ${itemId} not found`);

    return this.prisma.checklistItem.update({
      where: { id: itemId },
      data:  { checked: true, checkedById: driverId, checkedAt: new Date() },
    });
  }

  async getPassengerList(tenantId: string, tripId: string) {
    return this.prisma.traveler.findMany({
      where:   { tenantId, tripId },
      include: { ticket: { select: { fareClass: true, seatNumber: true, luggageKg: true } } },
      orderBy: { seatNumber: 'asc' },
    });
  }

  async getDriverSchedule(tenantId: string, driverId: string, from: Date, to: Date) {
    return this.prisma.trip.findMany({
      where:   { tenantId, driverId, departureTime: { gte: from, lte: to } },
      include: { route: true, bus: true },
      orderBy: { departureTime: 'asc' },
    });
  }
}
