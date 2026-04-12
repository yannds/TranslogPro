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
          senderName:    dto.senderName,
          senderPhone:   dto.senderPhone,
          recipientName: dto.recipientName,
          recipientPhone:dto.recipientPhone,
          originId:      dto.originId,
          destinationId: dto.destinationId,
          tripId:        dto.tripId,
          size:          dto.size,
          weightKg:      dto.weightKg,
          description:   dto.description,
          declaredValue: dto.declaredValue,
          status:        ParcelState.REGISTERED,
          version:       0,
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.PARCEL_REGISTERED,
        tenantId,
        aggregateId:   parcel.id,
        aggregateType: 'Parcel',
        payload:       { parcelId: parcel.id, trackingCode, tripId: dto.tripId },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return parcel;
    });
  }

  async findOne(tenantId: string, id: string) {
    const parcel = await this.prisma.parcel.findFirst({ where: { id, tenantId } });
    if (!parcel) throw new NotFoundException(`Parcel ${id} not found`);
    return parcel;
  }

  async trackByCode(tenantId: string, trackingCode: string) {
    const parcel = await this.prisma.parcel.findFirst({
      where:   { tenantId, trackingCode },
      include: { origin: true, destination: true },
    });
    if (!parcel) throw new NotFoundException(`Parcel with code ${trackingCode} not found`);
    return parcel;
  }

  async transition(
    tenantId:       string,
    parcelId:       string,
    targetState:    string,
    actor:          CurrentUserPayload,
    idempotencyKey?: string,
  ) {
    const parcel = await this.findOne(tenantId, parcelId);

    return this.workflow.transition(parcel as Parameters<typeof this.workflow.transition>[0], {
      targetState,
      actor,
      idempotencyKey,
    }, {
      aggregateType: 'Parcel',
      persist: async (entity, state, prisma) => {
        return prisma.parcel.update({
          where: { id: entity.id },
          data:  {
            status:  state,
            version: { increment: 1 },
            ...(state === ParcelState.DELIVERED ? { deliveredAt: new Date() } : {}),
          },
        }) as Promise<typeof entity>;
      },
    });
  }

  async findByTrip(tenantId: string, tripId: string) {
    return this.prisma.parcel.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private generateTrackingCode(tenantId: string): string {
    const prefix = tenantId.slice(0, 4).toUpperCase();
    const ts     = Date.now().toString(36).toUpperCase();
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }
}
