import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { ShipmentState, ParcelAction } from '../../common/constants/workflow-states';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async create(tenantId: string, dto: CreateShipmentDto, actor: CurrentUserPayload) {
    // Fix écart R4 — v8 audit : sans ce guard, plusieurs shipments sur le même
    // trip peuvent cumulativement dépasser la capacité d'emport du bus.
    // Défense DB R4 : SELECT FOR UPDATE sur Trip pour éviter race condition
    // entre 2 création simultanées de shipments.
    return this.prisma.transact(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM trips WHERE id = $1 FOR UPDATE`,
        dto.tripId,
      );

      const trip = await tx.trip.findFirst({
        where:   { id: dto.tripId, tenantId },
        include: { bus: { select: { luggageCapacityKg: true } } },
      });
      if (!trip) throw new NotFoundException(`Trip ${dto.tripId} introuvable`);

      const busCapacity = trip.bus?.luggageCapacityKg ?? 0;
      if (busCapacity > 0) {
        const existing = await tx.shipment.aggregate({
          where: {
            tenantId, tripId: dto.tripId,
            status: { in: [ShipmentState.OPEN, 'LOADED', 'IN_TRANSIT'] },
          },
          _sum: { totalWeight: true },
        });
        const usedKg = existing._sum.totalWeight ?? 0;
        if (usedKg + dto.maxWeightKg > busCapacity) {
          throw new BadRequestException(
            `Capacité d'emport bus dépassée : ${busCapacity}kg max, ` +
            `déjà ${usedKg}kg engagés, shipment demandé ${dto.maxWeightKg}kg ` +
            `→ total ${usedKg + dto.maxWeightKg}kg.`,
          );
        }
      }

      return tx.shipment.create({
        data: {
          tenantId,
          tripId:          dto.tripId,
          destinationId:   dto.destinationId,
          totalWeight:     dto.maxWeightKg,
          remainingWeight: dto.maxWeightKg,
          status:          ShipmentState.OPEN,
        },
      });
    });
  }

  /**
   * PRD §IV.2 — Ajout d'un colis à un shipment.
   *
   * Guards applicatifs :
   *   1. Shipment.destinationId == Parcel.destinationId
   *   2. Shipment.remainingWeight >= Parcel.weightKg
   *   3. Shipment.status == OPEN
   */
  async addParcel(
    tenantId:   string,
    shipmentId: string,
    parcelId:   string,
    actor:      CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const [shipment, parcel] = await Promise.all([
      this.prisma.shipment.findFirst({ where: { id: shipmentId, tenantId } }),
      this.prisma.parcel.findFirst({ where: { id: parcelId, tenantId } }),
    ]);

    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} introuvable`);
    if (!parcel)   throw new NotFoundException(`Colis ${parcelId} introuvable`);

    // Guard 1 — destination identique
    if (shipment.destinationId !== parcel.destinationId) {
      throw new BadRequestException(
        `Destination du colis (${parcel.destinationId}) ≠ destination du shipment (${shipment.destinationId})`,
      );
    }

    // Guard 2 — capacité poids
    const remaining = shipment.remainingWeight as number;
    const weight    = parcel.weight as number;
    if (remaining < weight) {
      throw new BadRequestException(
        `Capacité insuffisante : ${remaining}kg disponibles, colis pèse ${weight}kg`,
      );
    }

    // Guard 3 — shipment ouvert
    if (shipment.status !== ShipmentState.OPEN) {
      throw new BadRequestException(`Shipment ${shipmentId} n'est plus ouvert (status: ${shipment.status})`);
    }

    // Migration 2026-04-19 → blueprint-driven : la transition du parcel passe
    // par `WorkflowEngine.transition()` (action ADD_TO_SHIPMENT). L'engine
    // ouvre sa propre transaction — on y injecte le décrément du shipment
    // via la persist callback (même transaction atomique). L'événement est
    // publié post-commit via sideEffects.
    await this.workflow.transition(
      parcel as Parameters<typeof this.workflow.transition>[0],
      { action: ParcelAction.ADD_TO_SHIPMENT, actor, idempotencyKey },
      {
        aggregateType: 'Parcel',
        persist: async (entity, state, tx) => {
          // Décrément atomique du shipment dans la même tx que l'update parcel.
          await tx.shipment.update({
            where: { id: shipmentId },
            data:  { remainingWeight: { decrement: weight } },
          });
          return tx.parcel.update({
            where: { id: entity.id },
            data:  { shipmentId, status: state, version: { increment: 1 } },
          }) as Promise<typeof entity>;
        },
        sideEffects: [
          {
            name: 'publish_parcel_assigned_to_shipment',
            fn: async () => {
              const event: DomainEvent = {
                id:            uuidv4(),
                type:          'parcel.assigned_to_shipment',
                tenantId,
                aggregateId:   parcelId,
                aggregateType: 'Parcel',
                payload:       { parcelId, shipmentId, weight },
                occurredAt:    new Date(),
              };
              await this.prisma.transact(tx => this.eventBus.publish(event, tx));
            },
          },
        ],
      },
    );

    // Retourne le shipment à jour (tel que l'ancien contrat de retour).
    return this.prisma.shipment.findFirstOrThrow({ where: { id: shipmentId, tenantId } });
  }

  async findOne(tenantId: string, id: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where:   { id, tenantId },
      include: { parcels: true, trip: true, destination: true },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${id} introuvable`);
    return shipment;
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.shipment.findMany({
      where:   { tenantId, tripId },
      include: { parcels: { select: { id: true, trackingCode: true, status: true, weight: true } } },
    });
  }

  /**
   * Clôture du chargement — transition OPEN → LOADED pour signifier que
   * l'agent quai ou le chauffeur a terminé la mise en soute. Après cette
   * transition, plus aucun colis ne peut être ajouté au shipment
   * (`addParcel` vérifie `status === OPEN`).
   *
   * Pré-condition métier : tous les colis du shipment doivent être en état
   * LOADED. Sinon on renvoie BadRequest listant les colis qui bloquent —
   * l'utilisateur voit précisément ce qui manque.
   *
   * Idempotence : si le shipment est déjà LOADED/IN_TRANSIT/ARRIVED/CLOSED
   * on retourne l'état courant sans erreur (useful pour retries réseau).
   */
  async closeShipment(tenantId: string, shipmentId: string, actor: CurrentUserPayload) {
    const shipment = await this.prisma.shipment.findFirst({
      where:   { id: shipmentId, tenantId },
      include: { parcels: { select: { id: true, trackingCode: true, status: true } } },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} introuvable`);

    // Idempotence — déjà fermé
    if (shipment.status !== ShipmentState.OPEN) return shipment;

    // Tous les colis doivent être chargés (ou avoir avancé au-delà)
    const CLEARED = new Set(['LOADED', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED']);
    const blocking = shipment.parcels.filter(p => !CLEARED.has(p.status));
    if (blocking.length > 0) {
      throw new BadRequestException(
        `Impossible de clôturer : ${blocking.length} colis non chargés ` +
        `(${blocking.map(p => p.trackingCode).slice(0, 5).join(', ')}${blocking.length > 5 ? '…' : ''})`,
      );
    }

    // Transition via WorkflowEngine — action `LOAD` résolue contre le
    // WorkflowConfig(tenantId, 'Shipment', fromState, 'LOAD'). Le moteur
    // applique permissions, guards, audit log. Event outbox publié dans la
    // même transaction via la persist callback.
    const result = await this.workflow.transition(
      shipment as Parameters<typeof this.workflow.transition>[0],
      { action: 'LOAD', actor },
      {
        aggregateType: 'Shipment',
        persist: async (entity, toState, prisma) => {
          const updated = await prisma.shipment.update({
            where: { id: entity.id },
            data:  { status: toState, version: { increment: 1 } },
          });
          const event: DomainEvent = {
            id:            uuidv4(),
            type:          'shipment.closed',
            tenantId,
            aggregateId:   shipmentId,
            aggregateType: 'Shipment',
            payload: {
              shipmentId,
              tripId:      shipment.tripId,
              parcelCount: shipment.parcels.length,
              closedBy:    actor.id,
              fromState:   entity.status,
              toState,
            },
            occurredAt: new Date(),
          };
          await this.eventBus.publish(event, prisma as unknown as Parameters<typeof this.eventBus.publish>[1]);
          return updated as typeof entity;
        },
      },
    );
    return result.entity;
  }
}
