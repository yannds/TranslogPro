/**
 * UserNotificationListener — invitation user (USER_INVITED).
 *
 * Particularité par rapport aux autres listeners :
 *   - Pas de IN_APP : le user vient d'être créé, n'a pas encore de session.
 *   - Pas de SMS/WhatsApp : invite collaborateur = canal email professionnel.
 *   - EMAIL uniquement, à l'adresse fournie dans l'event payload.
 *
 * tenantId pris depuis l'event. Idempotency clé `invite:{tenantId}:{userId}`
 * pour ne pas spammer en cas de re-publication accidentelle (l'IEmailService
 * supporte idempotencyKey via SendEmailDto).
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { renderUserTemplate } from './email-templates/user-templates';

interface UserInvitePayload {
  userId?:     string;
  email?:      string;
  name?:       string;
  tenantName?: string;
  tenantSlug?: string;
  roleName?:   string | null;
  agencyName?: string | null;
  language?:   string;
  resetUrl?:   string;
}

@Injectable()
export class UserNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(UserNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.USER_INVITED, (e) => this.onUserInvited(e));
  }

  private async onUserInvited(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId = event.tenantId;
    const p        = (event.payload ?? {}) as UserInvitePayload;

    if (!p.email) {
      this.logger.debug(`[User USER_INVITED] payload sans email — skip (event=${event.id})`);
      return;
    }

    try {
      const lang = await this.resolveLanguage(tenantId, p.language ?? null);
      const out  = renderUserTemplate('user.invited', lang, {
        inviteeName: p.name       ?? '',
        tenantName:  p.tenantName ?? '',
        roleName:    p.roleName   ?? '',
        agencyName:  p.agencyName ?? '',
        resetUrl:    p.resetUrl   ?? '',
      });

      await this.notifications.send({
        tenantId,
        userId:     p.userId, // dispatche aussi en IN_APP s'il existe (rare)
        email:      p.email,
        channel:    'EMAIL',
        templateId: 'user.invited',
        title:      out.title,
        body:       out.body,
        html:       out.html,
        metadata: {
          userId:     p.userId ?? '',
          tenantSlug: p.tenantSlug ?? '',
        },
      });
    } catch (err) {
      this.logger.error(
        `[User USER_INVITED] dispatch failed (user=${p.userId}): ${(err as Error).message}`,
      );
    }
  }

  private async resolveLanguage(
    tenantId: string,
    payloadLang: string | null,
  ): Promise<'fr' | 'en'> {
    if (payloadLang === 'fr' || payloadLang === 'en') return payloadLang;
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { language: true },
    });
    return tenant?.language === 'en' ? 'en' : 'fr';
  }

  private async lifecycleEnabled(): Promise<boolean> {
    try {
      return await this.platformConfig.getBoolean('notifications.lifecycle.enabled');
    } catch {
      return true;
    }
  }
}
