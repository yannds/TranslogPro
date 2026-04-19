import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TripState, TripAction, TravelerAction } from '../../common/constants/workflow-states';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { assertTripOwnership } from '../../common/helpers/scope-filter';
import { TravelerService } from '../traveler/traveler.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';

/**
 * Flight-deck = Driver dashboard.
 * Provides the driver's view of their active trip, passenger list,
 * checklists, and schedule.
 */
@Injectable()
export class FlightDeckService {
  constructor(
    private readonly prisma:          PrismaService,
    private readonly travelerService: TravelerService,
    private readonly workflow:        WorkflowEngine,
  ) {}

  /**
   * Lazy-crée un Traveler si aucun n'existe pour ce ticket. L'état initial
   * n'est pas hardcodé : on interroge `workflow_configs` pour savoir à partir
   * de quel `fromState` l'action demandée est autorisée dans le blueprint du
   * tenant. Comme ça, si demain un tenant modifie son workflow (ex. fusionne
   * VERIFY + SCAN_IN en une seule étape), le lazy-create reste cohérent —
   * c'est tout l'intérêt du moteur DB-driven.
   *
   * Retourne systématiquement un Traveler valide ou lève.
   */
  private async ensureTraveler(
    tenantId: string,
    tripId:   string,
    ticketId: string,
    action:   string,
  ) {
    const existing = await this.prisma.traveler.findFirst({
      where: { ticketId, tenantId },
    });
    if (existing) return existing;

    // Ticket doit exister dans ce trip + ne pas être dans un état terminal
    // négatif. Le ticket peut être CONFIRMED ou PENDING_PAYMENT selon le
    // blueprint tenant (certains autorisent un scan gare avant encaissement).
    const ticket = await this.prisma.ticket.findFirst({
      where:  { id: ticketId, tenantId, tripId },
      select: { id: true, status: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable pour ce trajet`);
    if (['CANCELLED', 'EXPIRED', 'REFUNDED'].includes(ticket.status)) {
      throw new BadRequestException(
        `Ticket ${ticketId} ${ticket.status.toLowerCase()} — action refusée`,
      );
    }

    // Lookup blueprint : à quel fromState cette action est-elle valide ?
    const cfg = await this.prisma.workflowConfig.findFirst({
      where: {
        tenantId,
        entityType: 'Traveler',
        action,
        isActive:   true,
      },
      select: { fromState: true },
    });
    if (!cfg) {
      throw new BadRequestException(
        `Action ${action} non configurée pour Traveler dans ce tenant — ` +
        `vérifier le blueprint Voyageur`,
      );
    }

    return this.prisma.traveler.create({
      data: { tenantId, ticketId, tripId, status: cfg.fromState, version: 1 },
    });
  }

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

    // Priority 2: nearest upcoming or today's trip (skip past trips still stuck in PLANNED)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId: staffId,
        status: { in: [TripState.PLANNED, TripState.OPEN] },
        departureScheduled: { gte: startOfToday },
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

  /**
   * Valide une checklist pré-départ via le blueprint `checklist-departure`.
   *
   * Transition fast-track PENDING → APPROVED via action `complete`
   * (cf. DEFAULT_WORKFLOW_CONFIGS). Le champ legacy `isCompliant = true`
   * est conservé pour rétro-compat des callers qui lisent ce booléen.
   *
   * Si la checklist a un tenantId NULL (rows legacy avant 2026-04-19) on
   * backfill avec le tenantId courant avant la transition.
   */
  async completeChecklist(tenantId: string, checklistId: string, userId: string) {
    const item = await this.prisma.checklist.findFirst({
      where: { id: checklistId },
    });
    if (!item) throw new NotFoundException(`Checklist ${checklistId} introuvable`);

    // Backfill tenantId si manquant (legacy rows)
    const entity = item.tenantId
      ? item
      : await this.prisma.checklist.update({
          where: { id: checklistId },
          data:  { tenantId },
        });

    // Transition via WorkflowEngine — respecte le blueprint per-tenant
    const actor = { id: userId, tenantId } as CurrentUserPayload;
    const result = await this.workflow.transition(
      entity as Parameters<typeof this.workflow.transition>[0],
      { action: 'complete', actor },
      {
        aggregateType: 'Checklist',
        persist: async (e, toState, prisma) => {
          const updated = await prisma.checklist.update({
            where: { id: e.id },
            data:  {
              status:      toState,
              version:     { increment: 1 },
              isCompliant: true,  // rétro-compat : callers existants lisent ce booléen
            },
          });
          return updated as typeof e;
        },
      },
    );
    return result.entity;
  }

  /**
   * Compteurs live d'un trajet — **source de vérité** pour les écrans
   * embarqués (BusScreen) et le panneau quai (QuaiScreen). Requêtes count()
   * à chaque appel (polling 10s côté frontend), donc pas de dénormalisation
   * sur `Trip.passengersOnBoard` qui dérivait et causait des affichages
   * incohérents entre les deux écrans.
   *
   * Sources :
   *   - passengersOnBoard = Traveler(tripId).status='BOARDED'
   *   - passengersCheckedIn = Traveler(tripId).status IN ('CHECKED_IN','BOARDED')
   *   - passengersTotal = Ticket(tripId) non annulés — plafond attendu en cabine
   *   - parcelsLoaded = Parcel via Shipment(tripId) dont status IN ('LOADED','IN_TRANSIT')
   *   - parcelsTotal  = Parcel via Shipment(tripId) non CANCELLED
   *   - busCapacity   = Bus.capacity du trajet
   *   - updatedAt     = now() — sert à afficher "données à X min" côté UI
   */
  async getTripLiveStats(tenantId: string, tripId: string) {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: {
        id: true, status: true, departureScheduled: true,
        bus: { select: { capacity: true } },
      },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable dans ce tenant`);

    const [
      passengersOnBoard, passengersCheckedIn, passengersConfirmed, passengersTotal,
      parcelsLoaded, parcelsTotal,
    ] = await Promise.all([
      this.prisma.traveler.count({ where: { tenantId, tripId, status: 'BOARDED' } }),
      this.prisma.traveler.count({ where: { tenantId, tripId, status: { in: ['CHECKED_IN', 'BOARDED'] } } }),
      // passengersConfirmed = tickets confirmés (CONFIRMED ou déjà CHECKED_IN).
      // Consommé par QuaiScreen/BusScreen comme plafond "attendu" à bord vs
      // passengersTotal qui inclut aussi PENDING. On veut la source unique de
      // vérité "passagers qui ont effectivement un billet payé".
      this.prisma.ticket.count({ where: { tenantId, tripId, status: { in: ['CONFIRMED', 'CHECKED_IN'] } } }),
      this.prisma.ticket.count({ where: { tenantId, tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } } }),
      this.prisma.parcel.count({
        where: {
          tenantId,
          shipment: { tripId },
          status: { in: ['LOADED', 'IN_TRANSIT'] },
        },
      }),
      this.prisma.parcel.count({
        where: {
          tenantId,
          shipment: { tripId },
          status: { notIn: ['CANCELLED'] },
        },
      }),
    ]);

    // Retard : minutes écoulées depuis l'heure prévue si elle est dépassée et
    // que le trajet n'est pas encore marqué COMPLETED. Permet aux écrans
    // BusScreen/QuaiScreen d'afficher un badge + d'injecter une alerte dans le
    // ticker sans recalculer côté frontend.
    const scheduled = trip.departureScheduled ? trip.departureScheduled.getTime() : null;
    const nowMs     = Date.now();
    const isTerminal = trip.status === 'COMPLETED' || trip.status === 'CANCELLED';
    const delayMinutes = scheduled && !isTerminal && nowMs > scheduled
      ? Math.floor((nowMs - scheduled) / 60_000)
      : 0;

    return {
      tripId:              trip.id,
      tripStatus:          trip.status,
      scheduledDeparture:  trip.departureScheduled?.toISOString() ?? null,
      delayMinutes,
      passengersOnBoard,
      passengersCheckedIn,
      passengersConfirmed,
      passengersTotal,
      parcelsLoaded,
      parcelsTotal,
      busCapacity:         trip.bus?.capacity ?? 0,
      updatedAt:           new Date().toISOString(),
    };
  }

  /**
   * Upsert du poids bagage d'un ticket — utilisé par l'agent de quai (balance)
   * ou le chauffeur avant départ. Stratégie :
   *   - Supprime toutes les lignes Baggage du ticket puis recrée UNE ligne
   *     HOLD avec le nouveau poids (si > 0). Simplification volontaire v1 —
   *     une UX plus fine (cabine vs soute, historique, surcharge) pourra
   *     venir plus tard avec un endpoint dédié par bagage.
   * Retourne { ticketId, weightKg } consolidé.
   */
  async setLuggageWeight(
    tenantId: string,
    ticketId: string,
    weightKg: number,
  ): Promise<{ ticketId: string; weightKg: number }> {
    if (!Number.isFinite(weightKg) || weightKg < 0) {
      throw new BadRequestException('Poids invalide — doit être un nombre positif ou nul');
    }
    const ticket = await this.prisma.ticket.findFirst({
      where:  { id: ticketId, tenantId },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${ticketId} introuvable`);

    await this.prisma.$transaction([
      this.prisma.baggage.deleteMany({ where: { tenantId, ticketId } }),
      ...(weightKg > 0
        ? [this.prisma.baggage.create({
            data: { tenantId, ticketId, count: 1, weight: weightKg, type: 'HOLD' },
          })]
        : []),
    ]);

    return { ticketId, weightKg };
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

    // Enrich with luggage — somme des Baggage.weight par ticket. Plusieurs
    // lignes possibles (cabine + soute, corrections) → on agrège.
    const baggages = tickets.length > 0
      ? await this.prisma.baggage.findMany({
          where:  { tenantId, ticketId: { in: tickets.map(t => t.id) } },
          select: { ticketId: true, weight: true },
        })
      : [];
    const weightByTicket = new Map<string, number>();
    for (const b of baggages) {
      weightByTicket.set(b.ticketId, (weightByTicket.get(b.ticketId) ?? 0) + b.weight);
    }

    return tickets.map(t => ({
      id:             t.id,
      passengerName:  t.passengerName,
      passengerPhone: null as string | null,
      seatNumber:     t.seatNumber,
      fareClass:      (t as Record<string, unknown>).fareClass as string | null ?? null,
      status:         travelerMap.get(t.id) ?? t.status,
      luggageKg:      weightByTicket.get(t.id) ?? null,
      checkedInAt:    null as string | null,
      boardedAt:      null as string | null,
    }));
  }

  /**
   * Liste des colis enrichie pour les manifestes / écrans quai / BusScreen.
   *
   * Pourquoi un endpoint dédié plutôt que `trip.findOne().include.shipments.parcels` :
   *   - Le `findOne` du trip est appelé partout (détail, briefing, checkin, manifeste…)
   *     et gonflerait la payload pour les callers qui n'ont pas besoin des colis.
   *   - Ici on ne charge QUE ce que les écrans live ont besoin : id, code, statut,
   *     destination, poids. Tri stable (non-chargés en haut pour workflow). Polling
   *     côté client sans payload gigantesque.
   *
   * Filtre : exclut les `CANCELLED` (annulés ne comptent pas dans le manifeste
   * vivant). Les `LOST/DAMAGED` sont conservés pour traçabilité.
   */
  async getParcelList(tenantId: string, tripId: string) {
    const parcels = await this.prisma.parcel.findMany({
      where: {
        tenantId,
        shipment: { tripId },
        status:   { notIn: ['CANCELLED'] },
      },
      select: {
        id:           true,
        trackingCode: true,
        status:       true,
        weight:       true,
        destination:  { select: { id: true, name: true, city: true } },
      },
      orderBy: { trackingCode: 'asc' },
    });
    return parcels;
  }

  /**
   * Check-in d'un passager à l'entrée de la gare.
   *
   * Façade orientée BusScreen / PageDriverCheckin (accès par ticketId plutôt
   * que travelerId) — la transition réelle est déléguée à `TravelerService`
   * qui passe par le `WorkflowEngine`. Résultat : la transition respecte
   * `workflow_configs` du tenant (blueprint). Un tenant peut modifier son
   * workflow et l'app suit automatiquement — zéro hardcode des états.
   *
   * Lazy-creation : si aucun Traveler n'existe pour ce ticket, on le crée à
   * l'état prédecesseur de SCAN_IN dans le blueprint du tenant (VERIFIED par
   * défaut). Couvre le cas réel où les Traveler ne sont pas encore créés à la
   * vente du billet.
   */
  async checkInPassenger(
    tenantId: string,
    tripId:   string,
    ticketId: string,
    actor:    CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const traveler = await this.ensureTraveler(tenantId, tripId, ticketId, TravelerAction.SCAN_IN);
    return this.travelerService.scanIn(tenantId, traveler.id, actor, idempotencyKey);
  }

  /**
   * Embarquement bus — idem, facade ticketId-based qui délègue au
   * WorkflowEngine via TravelerService. Lazy-create à l'état prédecesseur de
   * SCAN_BOARD (CHECKED_IN par défaut) pour couvrir le cas driver qui
   * embarque sans scan gare préalable. Le blueprint peut refuser cette
   * transition si le tenant l'a configuré ainsi.
   */
  async boardPassenger(
    tenantId: string,
    tripId:   string,
    ticketId: string,
    actor:    CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const traveler = await this.ensureTraveler(tenantId, tripId, ticketId, TravelerAction.SCAN_BOARD);
    return this.travelerService.scanBoard(tenantId, traveler.id, actor, idempotencyKey);
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

  /**
   * Transition d'état déclenchée par le chauffeur depuis son portail.
   *
   * Depuis 2026-04-19 : passe par `WorkflowEngine.transition()` (blueprint-driven,
   * ADR-15/16 — zéro hardcode). L'ancien map `allowed` statique est supprimé.
   * Le blueprint tenant (DEFAULT_WORKFLOW_CONFIGS) définit les transitions :
   *   PLANNED → START_BOARDING → OPEN
   *   OPEN    → BEGIN_BOARDING → BOARDING
   *   BOARDING→ DEPART         → IN_PROGRESS
   *   IN_PROGRESS → END_TRIP   → COMPLETED
   *
   * Pour conserver l'UX driver (1 bouton = 1 cible), on mappe `nextStatus` →
   * séquence d'actions à exécuter (max 2 pour le cas PLANNED→BOARDING qui
   * traverse OPEN de façon transparente). Chaque action passe par l'engine :
   * permissions, guards, idempotence, audit — tout reste homogène.
   *
   * Defense in depth : on vérifie ownership chauffeur avant même la 1re transition.
   */
  async transitionTripStatus(
    tenantId: string,
    tripId:   string,
    userId:   string,
    nextStatus: 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED',
    actor?: CurrentUserPayload,
  ) {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { id: true, status: true, driverId: true, tenantId: true, version: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable dans ce tenant`);

    const staffId = await this.resolveStaffId(tenantId, userId);
    if (!staffId || trip.driverId !== staffId) {
      throw new ForbiddenException('Ce trajet n\'est pas assigné à ce chauffeur');
    }

    // Mappage cible → séquence d'actions (blueprint-compatible).
    // Si l'état courant n'a aucun chemin vers la cible, on rejette 400.
    const plan = this.planDriverActionSequence(trip.status, nextStatus);
    if (plan.length === 0) {
      throw new BadRequestException(
        `Transition interdite depuis l'état ${trip.status} vers ${nextStatus} ` +
        `(aucune séquence d'actions driver disponible dans le blueprint).`,
      );
    }

    // Acteur synthétique si actor absent (rétro-compat — le controller devrait
    // désormais passer user). La perm requise par le blueprint sera vérifiée
    // côté engine (data.trip.update.agency / data.trip.report.own).
    const effectiveActor: CurrentUserPayload = actor ?? ({
      id:       userId,
      roleId:   '',
      tenantId,
    } as CurrentUserPayload);

    let currentTrip = trip;
    for (const action of plan) {
      const result = await this.workflow.transition(
        currentTrip as Parameters<typeof this.workflow.transition>[0],
        { action, actor: effectiveActor },
        {
          aggregateType: 'Trip',
          persist: async (entity, state, p) => {
            return p.trip.update({
              where: { id: entity.id },
              data:  { status: state, version: { increment: 1 } },
            }) as Promise<typeof entity>;
          },
        },
      );
      currentTrip = result.entity as typeof currentTrip;
    }

    return { id: currentTrip.id, status: currentTrip.status };
  }

  /**
   * Calcule la séquence d'actions blueprint pour amener un trip à `target`
   * depuis son `from` courant. Au plus 2 actions (PLANNED → BOARDING traverse
   * OPEN en interne). Retourne [] si aucun chemin n'existe.
   *
   * Les transitions source sont alignées sur `DEFAULT_WORKFLOW_CONFIGS`
   * (prisma/seeds/iam.seed.ts) — en cas de divergence, priorité au blueprint DB :
   * l'engine refusera la 2e action si le blueprint du tenant est différent,
   * et on recevra une BadRequestException explicite.
   */
  private planDriverActionSequence(
    from:   string,
    target: 'BOARDING' | 'IN_PROGRESS' | 'COMPLETED',
  ): string[] {
    if (target === 'BOARDING') {
      if (from === TripState.PLANNED)  return [TripAction.START_BOARDING, TripAction.BEGIN_BOARDING];
      if (from === TripState.OPEN)     return [TripAction.BEGIN_BOARDING];
      return [];
    }
    if (target === 'IN_PROGRESS') {
      if (from === TripState.BOARDING) return [TripAction.DEPART];
      return [];
    }
    if (target === 'COMPLETED') {
      if (from === TripState.IN_PROGRESS) return [TripAction.END_TRIP];
      return [];
    }
    return [];
  }

  /**
   * Clôt le chargement du fret pour un trajet.
   *
   * Stamp `freightClosedAt` (+ acteur) sur Trip. Une fois posé, toute action
   * `LOAD` sur un colis lié au trajet sera refusée par `ParcelService.scan`
   * (cf. guard freightClosedAt). Les actions ARRIVE/DELIVER restent permises
   * (le verrou ne concerne que la phase chargement avant départ).
   *
   * Idempotent : un 2e appel ne change pas le timestamp existant — on retourne
   * juste l'état courant. C'est important pour les retries offline.
   *
   * Permission : appelée depuis le portail chauffeur ou agent quai (cf.
   * controller). Defense in depth : on vérifie ownership uniquement si l'acteur
   * est driver (rôle agent quai a un scope tenant + vérifie via permission).
   */
  async closeFreight(tenantId: string, tripId: string, actorUserId: string) {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { id: true, status: true, driverId: true, freightClosedAt: true, freightClosedById: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable dans ce tenant`);

    if (trip.freightClosedAt) {
      // Idempotent — déjà clôt, on retourne juste l'état actuel.
      return {
        id: trip.id,
        freightClosedAt: trip.freightClosedAt,
        freightClosedById: trip.freightClosedById,
      };
    }

    return this.prisma.trip.update({
      where:  { id: trip.id },
      data:   { freightClosedAt: new Date(), freightClosedById: actorUserId },
      select: { id: true, freightClosedAt: true, freightClosedById: true },
    });
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
