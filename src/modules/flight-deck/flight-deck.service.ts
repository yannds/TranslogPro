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

  /**
   * Trip.driverId is a Staff.id, not a User.id.
   * Resolve the logged-in user's userId to their staffId.
   */
  private async resolveStaffId(tenantId: string, userId: string): Promise<string | null> {
    const staff = await this.prisma.staff.findFirst({
      where: { userId, tenantId },
      select: { id: true },
    });
    return staff?.id ?? null;
  }

  /**
   * Returns the driver's current trip: active first (BOARDING/IN_PROGRESS),
   * otherwise the nearest upcoming trip (PLANNED/OPEN).
   */
  async getActiveTripForDriver(tenantId: string, userId: string) {
    const staffId = await this.resolveStaffId(tenantId, userId);
    if (!staffId) return null;

    const include = {
      route: {
        include: {
          origin:      { select: { id: true, name: true } },
          destination: { select: { id: true, name: true } },
        },
      },
      bus:       true,
      travelers: true,
      shipments: { include: { parcels: { select: { id: true, trackingCode: true, recipientInfo: true, status: true } } } },
    };

    // Priority 1: active trip (already in progress or boarding)
    const active = await this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId: staffId,
        status: { in: [TripState.BOARDING, TripState.IN_PROGRESS, TripState.IN_PROGRESS_PAUSED, TripState.IN_PROGRESS_DELAYED] },
      },
      include,
    });
    if (active) return active;

    // Priority 2: next upcoming trip (nearest departure)
    return this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId: staffId,
        status: { in: [TripState.PLANNED, TripState.OPEN] },
      },
      orderBy: { departureScheduled: 'asc' },
      include,
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
    // Ticket holds passengerName, seatNumber, fareClass, status.
    // Traveler is a thin join table; query Tickets directly for the manifest.
    const tickets = await this.prisma.ticket.findMany({
      where:   { tenantId, tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      orderBy: { passengerName: 'asc' },
    });

    // Enrich with traveler status (check-in / boarded)
    const travelers = await this.prisma.traveler.findMany({
      where: { tenantId, tripId },
      select: { ticketId: true, status: true },
    });
    const travelerMap = new Map(travelers.map(t => [t.ticketId, t.status]));

    return tickets.map(t => ({
      id:             t.id,
      passengerName:  t.passengerName,
      passengerPhone: null as string | null,
      seatNumber:     t.seatNumber,
      fareClass:      (t as Record<string, unknown>).fareClass as string | null ?? null,
      status:         travelerMap.get(t.id) ?? t.status,
      luggageKg:      null as number | null,
      checkedInAt:    null as string | null,
      boardedAt:      null as string | null,
    }));
  }

  /**
   * Board a passenger: update the Traveler status to BOARDED.
   * If no Traveler row exists yet for this ticket, create one.
   */
  async boardPassenger(tenantId: string, tripId: string, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, tenantId, tripId },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} not found`);

    // Upsert traveler
    const existing = await this.prisma.traveler.findFirst({
      where: { ticketId, tenantId },
    });

    if (existing) {
      return this.prisma.traveler.update({
        where: { id: existing.id },
        data:  { status: 'BOARDED' },
      });
    }

    return this.prisma.traveler.create({
      data: {
        tenantId,
        ticketId,
        tripId,
        status: 'BOARDED',
      },
    });
  }

  /**
   * Full trip detail for the driver schedule panel.
   * Returns route with waypoints, passenger count, checklist, and briefing status.
   */
  async getTripDetail(tenantId: string, tripId: string, userId: string) {
    const staffId = await this.resolveStaffId(tenantId, userId);

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId, ...(staffId ? { driverId: staffId } : {}) },
      include: {
        route: {
          include: {
            origin:      { select: { id: true, name: true, city: true } },
            destination:  { select: { id: true, name: true, city: true } },
            waypoints: {
              orderBy: { order: 'asc' },
              include: { station: { select: { id: true, name: true, city: true } } },
            },
          },
        },
        bus: true,
        checklists: { orderBy: { createdAt: 'asc' } },
        _count: { select: { travelers: true } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    // Briefing status for this driver on this trip
    let briefing: { briefedAt: string | null; crewRole: string } | null = null;
    if (staffId) {
      const assignment = await this.prisma.crewAssignment.findUnique({
        where: { tripId_staffId: { tripId, staffId } },
        select: { briefedAt: true, crewRole: true },
      });
      briefing = assignment
        ? { briefedAt: assignment.briefedAt?.toISOString() ?? null, crewRole: assignment.crewRole }
        : null;
    }

    return { ...trip, briefing };
  }

  async getDriverSchedule(tenantId: string, userId: string, from: Date, to: Date) {
    const staffId = await this.resolveStaffId(tenantId, userId);
    if (!staffId) return [];

    return this.prisma.trip.findMany({
      where:   { tenantId, driverId: staffId, departureScheduled: { gte: from, lte: to } },
      include: {
        route: { include: { origin: { select: { id: true, name: true } }, destination: { select: { id: true, name: true } } } },
        bus:   true,
        _count: { select: { travelers: true, checklists: true } },
      },
      orderBy: { departureScheduled: 'asc' },
    });
  }
}
