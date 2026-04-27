/**
 * AuthNotificationListener — fan-out EMAIL only des événements sécurité auth :
 *   AUTH_PASSWORD_RESET_LINK       → 'auth.password_reset.link'
 *   AUTH_PASSWORD_RESET_COMPLETED  → 'auth.password_reset.completed'
 *   AUTH_EMAIL_VERIFICATION_SENT   → 'auth.email_verification'
 *   AUTH_MFA_ENABLED               → 'auth.mfa.enabled'
 *   AUTH_MFA_DISABLED              → 'auth.mfa.disabled'
 *
 * Particularité : EMAIL only (pas IN_APP — l'utilisateur n'est pas forcément
 * connecté ; pas SMS — canal mail standard pour les alertes sécu). Le payload
 * de chaque event contient l'email destinataire — pas de lookup DB nécessaire.
 *
 * Pas de killswitch lifecycle.enabled : ces alertes sont CRITIQUES (sécurité).
 * On veut qu'elles arrivent même si on coupe les notifs lifecycle voyageur.
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus, EVENT_BUS, DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { renderAuthTemplate, AuthTemplateId } from './email-templates/auth-templates';

interface AuthEventPayload {
  userId?:      string;
  email?:       string;
  resetUrl?:    string;
  verifyUrl?:   string;
  setupUrl?:    string;
  expiresAt?:   string;
  completedAt?: string;
  ipAddress?:   string;
  tenantSlug?:  string;
  factor?:      string;
  source?:      string;
}

@Injectable()
export class AuthNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(AuthNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.AUTH_PASSWORD_RESET_LINK,        (e) => this.handle(e, 'auth.password_reset.link'));
    this.eventBus.subscribe(EventTypes.AUTH_PASSWORD_RESET_COMPLETED,   (e) => this.handle(e, 'auth.password_reset.completed'));
    this.eventBus.subscribe(EventTypes.AUTH_EMAIL_VERIFICATION_SENT,    (e) => this.handle(e, 'auth.email_verification'));
    this.eventBus.subscribe(EventTypes.AUTH_MFA_ENABLED,                (e) => this.handle(e, 'auth.mfa.enabled'));
    this.eventBus.subscribe(EventTypes.AUTH_MFA_DISABLED,               (e) => this.handle(e, 'auth.mfa.disabled'));
    this.eventBus.subscribe(EventTypes.AUTH_MFA_SUGGESTED,              (e) => this.handle(e, 'auth.mfa.suggested'));
  }

  private async handle(event: DomainEvent, templateId: AuthTemplateId): Promise<void> {
    const tenantId = event.tenantId;
    const p        = (event.payload ?? {}) as AuthEventPayload;

    if (!p.email) {
      this.logger.warn(`[Auth ${event.type}] payload sans email — skip (event=${event.id})`);
      return;
    }

    try {
      // Lookup tenant + user pour le nom (best-effort).
      const [user, tenant] = await Promise.all([
        p.userId
          ? this.prisma.user.findFirst({
              where:  { id: p.userId, tenantId },
              select: { name: true, email: true },
            })
          : Promise.resolve(null),
        this.prisma.tenant.findUnique({
          where:  { id: tenantId },
          select: { name: true, language: true },
        }),
      ]);

      const lang = (tenant?.language === 'en' ? 'en' : 'fr') as 'fr' | 'en';
      const out  = renderAuthTemplate(templateId, lang, {
        userName:    user?.name ?? p.email,
        tenantName:  tenant?.name ?? '',
        resetUrl:    p.resetUrl   ?? '',
        verifyUrl:   p.verifyUrl  ?? '',
        setupUrl:    p.setupUrl   ?? '',
        expiresAt:   p.expiresAt  ?? '',
        completedAt: p.completedAt ?? '',
        ipAddress:   p.ipAddress  ?? '',
        factor:      p.factor     ?? 'TOTP',
      });

      await this.notifications.send({
        tenantId,
        userId:     p.userId,
        email:      p.email,
        channel:    'EMAIL',
        templateId,
        title:      out.title,
        body:       out.body,
        html:       out.html,
        metadata: {
          userId:     p.userId ?? '',
          source:     p.source ?? '',
        },
      });

      // Suggestion MFA — envoi IN_APP additionnel pour laisser une trace
      // dans le bell icon du dashboard, même si l'utilisateur ne lit pas
      // ses emails. Email + IN_APP fan-out → l'utilisateur ne peut pas
      // rater l'incitation.
      if (templateId === 'auth.mfa.suggested' && p.userId) {
        await this.notifications.send({
          tenantId,
          userId:    p.userId,
          channel:   'IN_APP',
          templateId,
          title:     out.title,
          body:      out.body,
          metadata: {
            userId: p.userId,
            kind:   'mfa-suggestion',
          },
        });
      }
    } catch (err) {
      this.logger.error(`[Auth ${event.type}] dispatch failed: ${(err as Error).message}`);
    }
  }
}
