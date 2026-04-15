import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TripState } from '../../common/constants/workflow-states';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertTripOwnership } from '../../common/helpers/scope-filter';

/**
 * Flight-deck = Driver dashboard.
 * Provides the driver's view of their active trip, passenger list,
 * checklists, and schedule.
 */
@Injectable()
export class FlightDeckService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveTripForDriver(tenantId: string, driverId: string) {
    return this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId,
        status: { in: [TripState.BOARDING, TripState.IN_PROGRESS, TripState.IN_PROGRESS_PAUSED, TripState.IN_PROGRESS_DELAYED] },
      },
      include: {
        route:     true,
        bus:       true,
        travelers: true,
        shipments: { include: { parcels: { select: { id: true, trackingCode: true, recipientInfo: true, status: true } } } },
      },
    });
  }

  async getChecklist(tenantId: string, tripId: string, scope?: ScopeContext) {
    if (scope) await assertTripOwnership(this.prisma, tenantId, tripId, scope);
    return this.prisma.checklist.findMany({
      where:   { tripId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async completeChecklist(tenantId: string, checklistId: string, userId: string) {
    const item = await this.prisma.checklist.findFirst({
      where: { id: checklistId },
    });
    if (!item) throw new NotFoundException(`Checklist ${checklistId} introuvable`);

    return this.prisma.checklist.update({
      where: { id: checklistId },
      data:  { isCompliant: true },
    });
  }

  async getPassengerList(tenantId: string, tripId: string) {
    return this.prisma.traveler.findMany({
      where:   { tenantId, tripId },
      orderBy: { id: 'asc' },
    });
  }

  async getDriverSchedule(tenantId: string, driverId: string, from: Date, to: Date) {
    return this.prisma.trip.findMany({
      where:   { tenantId, driverId, departureScheduled: { gte: from, lte: to } },
      include: { route: true, bus: true },
      orderBy: { departureScheduled: 'asc' },
    });
  }
}
