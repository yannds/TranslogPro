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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async send(dto: SendNotificationDto): Promise<void> {
    await this.prisma.notification.create({
      data: {
        tenantId:   dto.tenantId,
        userId:     dto.userId,
        channel:    dto.channel,
        templateId: dto.templateId,
        variables:  dto.variables,
        status:     'PENDING',
      },
    });

    // Dispatch to channel adapter
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
        // In-app notifications are read via WebSocket or polling — already persisted
        break;
    }
  }

  private async sendSms(dto: SendNotificationDto): Promise<void> {
    if (!dto.phone) return;
    try {
      const config = await this.secretService.getSecretObject<{
        API_KEY: string; SENDER: string;
      }>(`tenants/${dto.tenantId}/sms`);
      // Integrate with SMS provider (e.g. Twilio, Orange API)
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

  async getUnread(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where:   { tenantId, userId, readAt: null },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
  }

  async markRead(tenantId: string, notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data:  { readAt: new Date() },
    });
  }

  // ── Event-driven notification triggers ───────────────────────────────────

  @OnEvent(EventTypes.TICKET_ISSUED)
  async onTicketIssued(payload: { tenantId: string; ticketId: string }) {
    this.logger.debug(`Notification trigger: ticket issued ${payload.ticketId}`);
    // Look up passenger phone and send confirmation SMS
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
