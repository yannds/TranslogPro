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

    return this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.create({
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

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.TRIP_PUBLISHED,
        tenantId,
        aggregateId:   trip.id,
        aggregateType: 'Trip',
        payload: {
          tripId:             trip.id,
          routeId:            trip.routeId,
          departureScheduled: trip.departureScheduled.toISOString(),
        },
        occurredAt: new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return trip;
    });
  }

  async findAll(
    tenantId: string,
    filters?: {
      agencyId?: string;
      status?:   string | string[];
      /** Filtre sur le chauffeur (Staff.id). Utilisé par la vue calendrier admin. */
      driverId?: string;
      /** Date début (ISO) — inclut les trajets avec departureScheduled >= from. */
      from?:     string;
      /** Date fin (ISO) — inclut les trajets avec departureScheduled <= to. */
      to?:       string;
    },
    scope?:   ScopeContext,
  ) {
    // scope 'own' : Trip.driverId est un Staff ID, pas un User ID.
    // Il faut résoudre le staffId du user pour filtrer correctement.
    //
    // scope 'agency' : Trip n'a pas de colonne agencyId directe. La relation
    // à l'agence se fait via `bus.agencyId`. On filtre donc sur la relation
    // Prisma imbriquée pour ne pas exposer les trajets des autres agences du
    // tenant à un AGENT_QUAI / AGENCY_MANAGER.
    let ownerFilter: Record<string, unknown> = {};
    if (scope?.scope === 'own') {
      const staff = await this.prisma.staff.findFirst({
        where: { userId: scope.userId, tenantId },
        select: { id: true },
      });
      ownerFilter = staff ? { driverId: staff.id } : { driverId: '__none__' };
    } else if (scope?.scope === 'agency') {
      ownerFilter = { bus: { agencyId: scope.agencyId ?? '__none__' } };
    } else if (scope) {
      ownerFilter = ownershipWhere(scope, 'driverId');
    }

    // Filtre fenêtre temporelle (utilisé par le calendrier chauffeur + quai home).
    //
    // Subtilité "date nue" (YYYY-MM-DD) : `new Date("2026-04-19")` → 00:00:00 UTC
    // exact. Si le frontend envoie `from=today&to=today`, le range devient
    // [00:00, 00:00] = un instant vide → aucun trip ne passe. On force donc
    // `to` à la fin de journée (23:59:59.999) pour que toute la journée soit
    // couverte. Le frontend qui envoie déjà une heure explicite (ISO complet)
    // n'est pas impacté car la heure est préservée par le constructeur Date.
    const dateRange: Record<string, Date> = {};
    if (filters?.from) dateRange.gte = new Date(filters.from);
    if (filters?.to) {
      const toDate = new Date(filters.to);
      // Si la chaîne est YYYY-MM-DD (pas d'heure), on étend à la fin de journée UTC
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(filters.to);
      if (isDateOnly) toDate.setUTCHours(23, 59, 59, 999);
      dateRange.lte = toDate;
    }

    // Filtre driverId explicite (admin/dispatcher). Se combine avec ownerFilter
    // mais ownerFilter est vide pour un admin sans scope 'own'.
    const explicitDriverFilter = filters?.driverId
      ? { driverId: filters.driverId }
      : {};

    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        ...(filters?.status
          ? Array.isArray(filters.status)
            ? { status: { in: filters.status } }
            : { status: filters.status }
          : {}),
        ...ownerFilter,
        ...explicitDriverFilter,
        ...(Object.keys(dateRange).length > 0
          ? { departureScheduled: dateRange }
          : {}),
      },
      include: {
        route: {
          include: {
            origin:      { select: { id: true, name: true, city: true } },
            destination: { select: { id: true, name: true, city: true } },
            waypoints: {
              orderBy: { order: 'asc' },
              include: { station: { select: { id: true, name: true, city: true } } },
            },
          },
        },
        bus: true,
      },
      orderBy: { departureScheduled: 'asc' },
    });

    // Enrichissement driver (Staff → User) — Trip.driverId est scalaire, pas
    // de relation Prisma objet. Batch via findMany pour éviter N+1 queries.
    const driverIds = Array.from(new Set(
      trips.map(t => t.driverId).filter((id): id is string => !!id),
    ));
    if (driverIds.length === 0) {
      return trips.map(t => ({ ...t, driver: null }));
    }
    const drivers = await this.prisma.staff.findMany({
      where:  { id: { in: driverIds }, tenantId },
      select: { id: true, user: { select: { id: true, name: true, email: true } } },
    });
    const driverMap = new Map(drivers.map(d => [d.id, d]));
    return trips.map(t => ({
      ...t,
      driver: t.driverId ? driverMap.get(t.driverId) ?? null : null,
    }));
  }

  /**
   * Trips "live" — pour le dashboard temps réel admin/manager.
   *
   * Filtre statuts en cours + enrichissement client-friendly :
   *   - state : 'planned' | 'on-time' | 'early' | 'delayed' | 'arrived' | 'suspended'
   *   - delayMinutes : signe + magnitude (négatif = en avance)
   *   - assignedSeats / capacity (déjà calculé par count travelers)
   *
   * Réutilise findAll avec un set de statuts fixes — la complexité est tout
   * entière dans le mapping post-process.
   */
  async findLive(tenantId: string, scope?: ScopeContext) {
    const STATUSES_LIVE = ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'SUSPENDED'];
    const trips = await this.findAll(tenantId, { status: STATUSES_LIVE }, scope);

    const now = Date.now();
    return trips.map((t) => {
      const scheduled = t.departureScheduled?.getTime?.() ?? null;
      const actual    = (t as { departureActual?: Date | null }).departureActual?.getTime() ?? null;
      const delayMinutes = scheduled && actual
        ? Math.round((actual - scheduled) / 60_000)
        : (scheduled && now > scheduled && t.status === 'PLANNED'
            ? Math.round((now - scheduled) / 60_000)
            : 0);

      let state: 'planned' | 'on-time' | 'early' | 'delayed' | 'arrived' | 'suspended' = 'planned';
      if (t.status === 'SUSPENDED' || t.status === 'CANCELLED')      state = 'suspended';
      else if (t.status === 'COMPLETED')                              state = 'arrived';
      else if (t.status === 'IN_PROGRESS' && delayMinutes >  10)      state = 'delayed';
      else if (t.status === 'IN_PROGRESS' && delayMinutes < -5)       state = 'early';
      else if (t.status === 'IN_PROGRESS')                            state = 'on-time';
      else if (t.status === 'BOARDING' || t.status === 'OPEN')        state = 'on-time';

      return {
        ...t,
        state,
        delayMinutes,
      };
    });
  }

  async findOne(tenantId: string, id: string, scope?: ScopeContext) {
    const trip = await this.prisma.trip.findFirst({
      where:   { id, tenantId },
      include: {
        route:     { include: { origin: true, destination: true } },
        bus:       true,
        travelers: true,
        _count:    { select: { shipments: true } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${id} not found`);
    // Enforcement scope : un chauffeur ne peut pas lire le trip d'un autre.
    // Pour le scope 'agency' on passe par bus.agencyId (Trip n'a pas de
    // colonne agencyId). Mismatch → NotFound (on cache l'existence du trip).
    if (scope?.scope === 'agency') {
      if (trip.bus?.agencyId && trip.bus.agencyId !== scope.agencyId) {
        throw new NotFoundException(`Trip ${id} not found`);
      }
    } else if (scope?.scope === 'own') {
      // Trip.driverId est un Staff.id, pas un User.id → on ne peut pas
      // utiliser assertOwnership(scope, trip, 'driverId') qui compare à
      // scope.userId. On résout d'abord le Staff de l'acteur puis compare.
      const staff = await this.prisma.staff.findFirst({
        where:  { tenantId, userId: scope.userId },
        select: { id: true },
      });
      if (!staff || trip.driverId !== staff.id) {
        throw new NotFoundException(`Trip ${id} not found`);
      }
    }

    // Driver est lié à Trip via driverId scalaire (pas de relation Prisma objet).
    // On résout le Staff → User pour exposer le nom côté admin/dispatcher.
    const driver = trip.driverId
      ? await this.prisma.staff.findUnique({
          where:  { id: trip.driverId },
          select: {
            id: true,
            user: { select: { id: true, name: true, email: true } },
          },
        })
      : null;

    return { ...trip, driver };
  }

  async update(tenantId: string, tripId: string, dto: {
    busId?: string; driverId?: string;
    departureTime?: string; estimatedArrivalTime?: string;
    seatingMode?: 'FREE' | 'NUMBERED';
  }) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} not found`);

    // Only PLANNED or OPEN trips can be edited
    if (!['PLANNED', 'OPEN'].includes(trip.status)) {
      throw new ConflictException(
        `Impossible de modifier un trajet en statut « ${trip.status} ». Seuls les trajets PLANIFIÉS ou OUVERTS peuvent être modifiés.`,
      );
    }

    const data: Record<string, unknown> = {};

    if (dto.departureTime) data.departureScheduled = new Date(dto.departureTime);
    if (dto.estimatedArrivalTime) data.arrivalScheduled = new Date(dto.estimatedArrivalTime);
    if (dto.busId) data.busId = dto.busId;
    if (dto.driverId) data.driverId = dto.driverId;

    // Seating mode validation
    if (dto.seatingMode) {
      if (dto.seatingMode === 'NUMBERED') {
        const busId = dto.busId ?? trip.busId;
        const bus = await this.prisma.bus.findUniqueOrThrow({ where: { id: busId } });
        if (!bus.seatLayout) {
          throw new BadRequestException(
            'Le bus sélectionné n\'a pas de plan de sièges configuré. Configurez-le avant de passer en mode NUMBERED.',
          );
        }
        // If tickets already sold with seat numbers, disallow switching back to FREE
      }
      if (dto.seatingMode === 'FREE' && trip.seatingMode === 'NUMBERED') {
        const ticketsWithSeats = await this.prisma.ticket.count({
          where: { tripId, tenantId, status: { notIn: ['CANCELLED', 'EXPIRED'] }, seatNumber: { not: null } },
        });
        if (ticketsWithSeats > 0) {
          throw new ConflictException(
            `Impossible de repasser en placement libre : ${ticketsWithSeats} billet(s) ont d��jà un siège attribué.`,
          );
        }
      }
      data.seatingMode = dto.seatingMode;
    }

    return this.prisma.trip.update({
      where: { id: tripId },
      data,
    });
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
      include: { bus: { select: { id: true, capacity: true, seatLayout: true, isFullVip: true, vipSeats: true } } },
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
      isFullVip:        (trip.bus as any).isFullVip ?? false,
      vipSeats:         (trip.bus as any).vipSeats ?? [],
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
      [TripState.BOARDING]:           EventTypes.TRIP_BOARDING_OPENED,
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
