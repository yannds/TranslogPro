import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { EventTypes } from '../../common/types/domain-event.type';

export interface SendNotificationDto {
  tenantId:   string;
  userId?:    string;
  phone?:     string;
  channel:    'SMS' | 'PUSH' | 'EMAIL' | 'IN_APP';
  templateId: string;
  variables:  Record<string, string>;
}

/**
 * Notification service — pas de table Notification en DB.
 * Les notifications sont envoyées via adaptateurs de canal (SMS, push, email).
 * L'historique est un TODO : ajouter le modèle Notification dans le schéma Prisma si besoin.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendNotificationDto): Promise<void> {
    this.logger.debug(
      `Sending ${dto.channel} notification to user=${dto.userId ?? 'anon'} template=${dto.templateId}`,
    );

    switch (dto.channel) {
      case 'SMS':
        await this.sendSms(dto);
        break;
      case 'PUSH':
        await this.sendPush(dto);
        break;
      case 'EMAIL':
        await this.sendEmail(dto);
        break;
      case 'IN_APP':
        break;
    }
  }

  private async sendSms(dto: SendNotificationDto): Promise<void> {
    if (!dto.phone) return;
    try {
      await this.secretService.getSecretObject<{ API_KEY: string; SENDER: string }>(
        `tenants/${dto.tenantId}/sms`,
      );
      this.logger.debug(`SMS → ${dto.phone} via template ${dto.templateId}`);
    } catch (err) {
      this.logger.error(`SMS send failed: ${(err as Error).message}`);
    }
  }

  private async sendPush(dto: SendNotificationDto): Promise<void> {
    this.logger.debug(`PUSH → user ${dto.userId} via template ${dto.templateId}`);
  }

  private async sendEmail(dto: SendNotificationDto): Promise<void> {
    this.logger.debug(`EMAIL → user ${dto.userId} via template ${dto.templateId}`);
  }

  async getUnread(_tenantId: string, _userId: string) {
    // TODO: add Notification model to schema for persistence
    return [];
  }

  async markRead(_tenantId: string, _notificationId: string) {
    // TODO: add Notification model to schema for persistence
    return { id: _notificationId, readAt: new Date() };
  }

  @OnEvent(EventTypes.TICKET_ISSUED)
  async onTicketIssued(payload: { tenantId: string; ticketId: string }) {
    this.logger.debug(`Notification trigger: ticket issued ${payload.ticketId}`);
  }

  @OnEvent(EventTypes.INCIDENT_SOS)
  async onSos(payload: { tenantId: string; incidentId: string; tripId?: string }) {
    this.logger.warn(`SOS received for trip ${payload.tripId} — dispatching emergency notifications`);
  }

  @OnEvent(EventTypes.TRIP_DELAYED)
  async onTripDelayed(payload: { tenantId: string; tripId: string }) {
    this.logger.debug(`Trip delayed notification trigger: ${payload.tripId}`);
  }
}
