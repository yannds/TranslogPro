import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { ParcelState } from '../../common/constants/workflow-states';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CreateParcelDto } from './dto/create-parcel.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ParcelService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly workflow: WorkflowEngine,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  async register(tenantId: string, dto: CreateParcelDto, actor: CurrentUserPayload) {
    const trackingCode = this.generateTrackingCode(tenantId);

    return this.prisma.transact(async (tx) => {
      const parcel = await tx.parcel.create({
        data: {
          tenantId,
          trackingCode,
          senderId:      actor.id,
          weight:        dto.weightKg,
          price:         dto.declaredValue ?? 0,
          destinationId: dto.destinationId,
          recipientInfo: {
            name:    dto.recipientName,
            phone:   dto.recipientPhone,
            address: dto.address ?? '',
          },
          status:  ParcelState.CREATED,
          version: 0,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.PARCEL_REGISTERED,
        tenantId,
        aggregateId:   parcel.id,
        aggregateType: 'Parcel',
        payload:       { parcelId: parcel.id, trackingCode },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return parcel;
    });
  }

  async findAll(tenantId: string, filters?: { status?: string }) {
    return this.prisma.parcel.findMany({
      where: {
        tenantId,
        ...(filters?.status ? { status: filters.status } : {}),
      },
      include: { destination: true, shipment: { select: { id: true, tripId: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where: { id, tenantId },
      include: { destination: true, shipment: { select: { id: true, tripId: true, status: true } } },
    });
    if (!parcel) throw new NotFoundException(`Parcel ${id} not found`);
    return parcel;
  }

  async trackByCode(tenantId: string, trackingCode: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where:   { tenantId, trackingCode },
      include: { destination: true },
    });
    if (!parcel) throw new NotFoundException(`Parcel with code ${trackingCode} not found`);
    return parcel;
  }

  async transition(
    tenantId:        string,
    parcelId:        string,
    action:          string,
    actor:           CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const parcel = await this.findOne(tenantId, parcelId);

    return this.workflow.transition(parcel as Parameters<typeof this.workflow.transition>[0], {
      action,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Parcel',
      persist: async (entity, state, p) => {
        return p.parcel.update({
          where: { id: entity.id },
          data:  {
            status:  state,
            version: { increment: 1 },
          },
        }) as Promise<typeof entity>;
      },
    });
  }

  /** Scan chargement/déchargement — mappe l'action sur une transition workflow */
  async scan(
    tenantId:        string,
    parcelId:        string,
    action:          string,
    _stationId:      string,
    actor:           CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    return this.transition(tenantId, parcelId, action, actor, idempotencyKey);
  }

  /** Signalement dommage — transition vers DAMAGED */
  async reportDamage(
    tenantId:    string,
    parcelId:    string,
    description: string,
    actor:       CurrentUserPayload,
  ) {
    return this.transition(tenantId, parcelId, 'DAMAGE', actor, undefined);
  }

  async findByShipment(tenantId: string, shipmentId: string) {
    return this.prisma.parcel.findMany({
      where:   { tenantId, shipmentId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Liste les colis expédiés par l'utilisateur courant (CUSTOMER) — page
   * "Mes colis". Filtré par senderId — un client ne voit jamais les colis
   * d'autrui. Inclut destination pour l'affichage. Tri par création desc.
   */
  async findMine(tenantId: string, userId: string) {
    return this.prisma.parcel.findMany({
      where:   { tenantId, senderId: userId },
      include: { destination: true },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }

  private generateTrackingCode(tenantId: string): string {
    const prefix = tenantId.slice(0, 4).toUpperCase();
    const ts     = Date.now().toString(36).toUpperCase();
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }
}
