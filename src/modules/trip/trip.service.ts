import { Injectable, NotFoundException, Inject, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { TripState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { ownershipWhere, assertOwnership } from '../../common/helpers/scope-filter';
import { CreateTripDto } from './dto/create-trip.dto';
import { SchedulingGuardService } from '../scheduling-guard/scheduling-guard.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TripService {
  constructor(
    private readonly prisma:           PrismaService,
    private readonly workflow:         WorkflowEngine,
    private readonly schedulingGuard:  SchedulingGuardService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateTripDto) {
    // ── Scheduling Guard: vérifie bus + chauffeur avant création ──────────────
    const check = await this.schedulingGuard.checkAssignability(
      tenantId,
      dto.busId,
      dto.driverId,
    );
    if (!check.canAssign) {
      const details = check.reasons.map(r => r.message).join(' | ');
      throw new BadRequestException(`Affectation impossible: ${details}`);
    }

    const departure = new Date(dto.departureTime);
    const arrival   = dto.estimatedArrivalTime
      ? new Date(dto.estimatedArrivalTime)
      : new Date(departure.getTime() + 3600_000); // +1h par défaut pour la détection de chevauchement

    // ── Anti-doublon : vérifier chevauchement bus OU chauffeur ───────────────
    const overlap = await this.prisma.trip.findFirst({
      where: {
        tenantId,
        status: { notIn: [TripState.CANCELLED, TripState.COMPLETED] },
        OR: [
          { busId: dto.busId },
          { driverId: dto.driverId },
        ],
        departureScheduled: { lt: arrival },
        arrivalScheduled:   { gt: departure },
      },
    });
    if (overlap) {
      const what = overlap.busId === dto.busId ? 'Ce véhicule' : 'Ce chauffeur';
      throw new BadRequestException(
        `${what} est déjà affecté à un trajet sur ce créneau (${overlap.id})`,
      );
    }

    // ── Seating mode : si NUMBERED, le bus doit avoir un seatLayout configuré ──
    const seatingMode = dto.seatingMode ?? 'FREE';
    if (seatingMode === 'NUMBERED') {
      const bus = await this.prisma.bus.findUniqueOrThrow({ where: { id: dto.busId } });
      if (!bus.seatLayout) {
        throw new BadRequestException(
          'Le bus sélectionné n\'a pas de plan de sièges configuré. Configurez-le avant de créer un trajet en mode NUMBERED.',
        );
      }
    }

    return this.prisma.trip.create({
      data: {
        tenantId,
        routeId:             dto.routeId,
        busId:               dto.busId,
        driverId:            dto.driverId,
        departureScheduled:  departure,
        arrivalScheduled:    arrival,
        seatingMode,
        status:              TripState.PLANNED,
        version:             0,
      },
    });
  }

  async findAll(
    tenantId: string,
    filters?: { agencyId?: string; status?: string | string[] },
    scope?:   ScopeContext,
  ) {
    // scope 'own' : Trip.driverId est un Staff ID, pas un User ID.
    // Il faut résoudre le staffId du user pour filtrer correctement.
    let ownerFilter: Record<string, string> = {};
    if (scope?.scope === 'own') {
      const staff = await this.prisma.staff.findFirst({
        where: { userId: scope.userId, tenantId },
        select: { id: true },
      });
      ownerFilter = staff ? { driverId: staff.id } : { driverId: '__none__' };
    } else if (scope) {
      ownerFilter = ownershipWhere(scope, 'driverId');
    }

    return this.prisma.trip.findMany({
      where: {
        tenantId,
        ...(filters?.status
          ? Array.isArray(filters.status)
            ? { status: { in: filters.status } }
            : { status: filters.status }
          : {}),
        ...ownerFilter,
      },
      include: {
        route: { include: { origin: true, destination: true } },
        bus: true,
      },
      orderBy: { departureScheduled: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string, scope?: ScopeContext) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id, tenantId },
      include: { route: true, bus: true, travelers: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    // Enforcement scope : un chauffeur ne peut pas lire le trip d'un autre.
    if (scope) assertOwnership(scope, trip, 'driverId');
    return trip;
  }

  async remove(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);
    if (trip.status !== TripState.PLANNED) {
      throw new ConflictException(
        `Impossible de supprimer un trajet en statut « ${trip.status} ». Seuls les trajets PLANIFIÉS peuvent être supprimés.`,
      );
    }

    // Suppression en cascade dans une transaction
    await this.prisma.$transaction([
      this.prisma.crewAssignment.deleteMany({ where: { tripId, tenantId } }),
      this.prisma.checklist.deleteMany({ where: { tripId } }),
      this.prisma.tripEvent.deleteMany({ where: { tripId } }),
      this.prisma.trip.delete({ where: { id: tripId } }),
    ]);

    return { deleted: true };
  }

  /**
   * Retourne la carte des sièges d'un trip : layout du bus, sièges occupés,
   * disponibilité, et le montant de l'option choix de siège.
   */
  async getSeats(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
      include: { bus: { select: { id: true, capacity: true, seatLayout: true } } },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    const seatLayout = trip.bus.seatLayout as { rows: number; cols: number; aisleAfter?: number; disabled?: string[] } | null;

    // Billets actifs (ni annulés ni expirés)
    const activeTickets = await this.prisma.ticket.findMany({
      where: {
        tenantId,
        tripId,
        status: { notIn: ['CANCELLED', 'EXPIRED'] },
      },
      select: { seatNumber: true },
    });

    const occupiedSeats = activeTickets
      .map(t => t.seatNumber)
      .filter((s): s is string => s !== null && s !== '');

    // Calcul du nombre total de sièges actifs
    let totalSeats = trip.bus.capacity;
    if (seatLayout) {
      const disabledCount = seatLayout.disabled?.length ?? 0;
      totalSeats = seatLayout.rows * seatLayout.cols - disabledCount;
    }

    // Montant option choix de siège (depuis TenantBusinessConfig)
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
      select: { seatSelectionFee: true },
    });

    return {
      seatingMode:      trip.seatingMode,
      seatLayout,
      occupiedSeats,
      availableCount:   Math.max(0, totalSeats - occupiedSeats.length),
      totalCount:       totalSeats,
      soldCount:        activeTickets.length,
      seatSelectionFee: bizConfig?.seatSelectionFee ?? 0,
    };
  }

  async transition(
    tenantId:       string,
    tripId:         string,
    action:         string,
    actor:          CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const trip = await this.findOne(tenantId, tripId);

    const eventTypeMap: Record<string, string> = {
      [TripState.BOARDING]:           EventTypes.TRIP_STARTED,
      [TripState.IN_PROGRESS]:        EventTypes.TRIP_STARTED,
      [TripState.IN_PROGRESS_PAUSED]: EventTypes.TRIP_PAUSED,
      [TripState.IN_PROGRESS_DELAYED]:EventTypes.TRIP_DELAYED,
      [TripState.COMPLETED]:          EventTypes.TRIP_COMPLETED,
      [TripState.CANCELLED]:          EventTypes.TRIP_CANCELLED,
    };

    return this.workflow.transition(trip as any, {
      action,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Trip',
      persist: async (entity, state, prisma) => {
        const updated = await prisma.trip.update({
          where: { id: entity.id },
          data:  {
            status:  state,
            version: { increment: 1 },
          },
        });
        const eventType = eventTypeMap[state] ?? `trip.${state.toLowerCase()}`;
        const event: DomainEvent = {
          id:            uuidv4(),
          type:          eventType,
          tenantId:      entity.tenantId,
          aggregateId:   entity.id,
          aggregateType: 'Trip',
          payload:       { tripId: entity.id, fromState: entity.status, toState: state },
          occurredAt:    new Date(),
        };
        await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
        return updated as typeof entity;
      },
    });
  }
}
