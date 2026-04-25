import { Injectable, Logger, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISmsService, IWhatsappService, SMS_SERVICE, WHATSAPP_SERVICE } from '../../infrastructure/notification/interfaces/sms.interface';
import { IEmailService, EMAIL_SERVICE } from '../../infrastructure/notification/interfaces/email.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';

export interface SendNotificationDto {
  tenantId:    string;
  userId?:     string;
  phone?:      string;
  /** Destinataire email — requis si canal = EMAIL. */
  email?:      string;
  channel:     'SMS' | 'WHATSAPP' | 'PUSH' | 'EMAIL' | 'IN_APP';
  templateId:  string;
  title?:      string;
  body:        string;          // message déjà rendu (variables substituées par l'appelant)
  /** HTML optionnel pour le canal EMAIL. Si absent, `body` est utilisé en text/plain. */
  html?:       string;
  metadata?:   Record<string, string>;
}

/**
 * NotificationService — orchestre l'envoi multi-canal et persiste l'historique.
 *
 * Architecture :
 *   SMS     → TwilioSmsService      (via ISmsService)
 *   WHATSAPP→ TwilioWhatsappService (via IWhatsappService)
 *   PUSH    → stub (Firebase/OneSignal — à brancher en Phase 4)
 *   EMAIL   → IEmailService (provider console|o365|resend|smtp — EmailProviderFactory)
 *   IN_APP  → persist uniquement (lu via getUnread())
 *
 * Persistance : chaque notification est créée en DB au statut PENDING,
 * puis mise à jour SENT/FAILED selon la réponse du provider.
 * Les préférences utilisateur (NotificationPreference) sont consultées avant envoi.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_SERVICE)      private readonly smsService:      ISmsService,
    @Inject(WHATSAPP_SERVICE) private readonly whatsappService: IWhatsappService,
    @Inject(EMAIL_SERVICE)    private readonly emailService:    IEmailService,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  async send(dto: SendNotificationDto): Promise<boolean> {
    // 1. Vérifier les préférences utilisateur (tenant-scoped)
    if (dto.userId) {
      const prefs = await this.prisma.notificationPreference.findFirst({
        where: { tenantId: dto.tenantId, userId: dto.userId },
      });
      if (prefs && !this.isChannelEnabled(prefs, dto.channel)) {
        this.logger.debug(
          `Channel ${dto.channel} disabled for user ${dto.userId} — skipped`,
        );
        return false;
      }
    }

    // 2. Créer l'entrée DB PENDING
    const notification = dto.userId
      ? await this.prisma.notification.create({
          data: {
            tenantId:   dto.tenantId,
            userId:     dto.userId,
            channel:    dto.channel,
            templateId: dto.templateId,
            title:      dto.title,
            body:       dto.body,
            metadata:   dto.metadata ?? {},
            status:     'PENDING',
          },
        })
      : null;

    // 3. Envoi selon canal
    try {
      await this.dispatch(dto);

      // 4a. Mise à jour SENT
      if (notification) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data:  { status: 'SENT', sentAt: new Date() },
        });
      }
      return true;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`[Notification] Send failed channel=${dto.channel}: ${reason}`);

      // 4b. Mise à jour FAILED
      if (notification) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data:  {
            status:      'FAILED',
            failReason:  reason.slice(0, 500),
            attempts:    { increment: 1 },
          },
        });
      }
      return false;
    }
  }

  /**
   * Envoie un message en essayant WhatsApp en premier, puis SMS en repli si
   * l'envoi WhatsApp échoue. Pas d'erreur propagée — le caller peut faire du
   * fire-and-forget. Retourne le canal utilisé (ou null si aucun n'a marché).
   */
  async sendWithChannelFallback(opts: {
    tenantId:    string;
    phone:       string;
    templateId:  string;
    body:        string;
    title?:      string;
    metadata?:   Record<string, string>;
  }): Promise<'WHATSAPP' | 'SMS' | null> {
    const base = {
      tenantId:   opts.tenantId,
      phone:      opts.phone,
      templateId: opts.templateId,
      body:       opts.body,
      title:      opts.title,
      metadata:   opts.metadata,
    };
    const whatsappOk = await this.send({ ...base, channel: 'WHATSAPP' });
    if (whatsappOk) return 'WHATSAPP';
    const smsOk = await this.send({ ...base, channel: 'SMS' });
    return smsOk ? 'SMS' : null;
  }

  async getUnread(tenantId: string, userId: string) {
    return this.prisma.notification.findMany({
      where:   { tenantId, userId, status: { not: 'READ' } },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select: {
        id: true, channel: true, title: true, body: true,
        status: true, createdAt: true, sentAt: true,
      },
    });
  }

  async markRead(tenantId: string, notificationId: string, scope?: ScopeContext) {
    if (scope?.scope === 'own') {
      const notif = await this.prisma.notification.findFirst({
        where:  { id: notificationId, tenantId },
        select: { userId: true },
      });
      if (!notif) throw new NotFoundException(`Notification ${notificationId} introuvable`);
      if (notif.userId !== scope.userId) {
        throw new ForbiddenException(`Scope 'own' violation — notification not owned by actor`);
      }
    }
    return this.prisma.notification.update({
      where: { id: notificationId },
      data:  { status: 'READ', readAt: new Date() },
    });
  }

  // ─── Domain event handlers ────────────────────────────────────────────────────
  //
  // TICKET_ISSUED + TRIP_BOARDING_OPENED + TRIP_COMPLETED + TRIP_REMINDER_DUE +
  // TRIP_PUBLISHED sont gérés par LifecycleNotificationListener (multi-canal,
  // i18n, fan-out passagers). Ce service expose uniquement les hooks ad-hoc
  // (SOS, retard) et l'API send().

  @OnEvent(EventTypes.INCIDENT_SOS)
  async onSos(payload: { tenantId: string; incidentId: string; tripId?: string; dispatchPhone?: string }) {
    this.logger.warn(`SOS received for trip ${payload.tripId} — dispatching emergency notifications`);
    if (payload.dispatchPhone) {
      await this.send({
        tenantId:   payload.tenantId,
        phone:      payload.dispatchPhone,
        channel:    'SMS',
        templateId: 'incident.sos',
        title:      '🚨 SOS',
        body:       `SOS déclenché — Trip: ${payload.tripId ?? 'N/A'}. Incident: ${payload.incidentId}`,
        metadata:   { incidentId: payload.incidentId, tripId: payload.tripId ?? '' },
      });
    }
  }

  @OnEvent(EventTypes.TRIP_DELAYED)
  async onTripDelayed(payload: { tenantId: string; tripId: string; passengerPhones?: string[] }) {
    this.logger.debug(`Trip delayed notification trigger: ${payload.tripId}`);
    for (const phone of payload.passengerPhones ?? []) {
      await this.send({
        tenantId:   payload.tenantId,
        phone,
        channel:    'WHATSAPP',
        templateId: 'trip.delayed',
        body:       `Votre trajet ${payload.tripId} a été retardé. Consultez l'appli pour l'ETA mis à jour.`,
        metadata:   { tripId: payload.tripId },
      });
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async dispatch(dto: SendNotificationDto): Promise<void> {
    switch (dto.channel) {
      case 'SMS':
        if (!dto.phone) throw new Error('phone requis pour canal SMS');
        await this.smsService.send({
          to:       dto.phone,
          body:     dto.body,
          tenantId: dto.tenantId,
        });
        break;

      case 'WHATSAPP':
        if (!dto.phone) throw new Error('phone requis pour canal WHATSAPP');
        await this.whatsappService.send({
          to:       dto.phone,
          body:     dto.body,
          tenantId: dto.tenantId,
        });
        break;

      case 'PUSH':
        // Phase 4 : brancher Firebase Admin SDK via IVaultService
        this.logger.debug(`[PUSH] stub — userId=${dto.userId} template=${dto.templateId}`);
        break;

      case 'EMAIL': {
        if (!dto.email) throw new Error('email requis pour canal EMAIL');
        const hasHtml = typeof dto.html === 'string' && dto.html.length > 0;
        await this.emailService.send({
          to:       { email: dto.email },
          subject:  dto.title ?? dto.templateId,
          html:     hasHtml ? dto.html : undefined,
          text:     hasHtml ? dto.body : dto.body,
          category: 'transactional',
          tenantId: dto.tenantId,
        });
        break;
      }

      case 'IN_APP':
        // Persisté en DB uniquement — pas d'envoi externe
        break;
    }
  }

  private isChannelEnabled(
    prefs:   { sms: boolean; whatsapp: boolean; push: boolean; email: boolean },
    channel: SendNotificationDto['channel'],
  ): boolean {
    switch (channel) {
      case 'SMS':       return prefs.sms;
      case 'WHATSAPP':  return prefs.whatsapp;
      case 'PUSH':      return prefs.push;
      case 'EMAIL':     return prefs.email;
      case 'IN_APP':    return true;
      default:          return false;
    }
  }

  // ── Préférences utilisateur (Module L PRD — UI self-service) ─────────────────

  /**
   * Retourne les préférences du user. Si aucune n'existe, retourne les
   * defaults Prisma (sms/whatsapp/push activés, email désactivé) sans
   * créer la ligne — création paresseuse au premier upsert.
   */
  async getPreferences(tenantId: string, userId: string) {
    // Security : tenantId racine du where (règle ADR "tenantId always in WHERE").
    // userId est déjà @unique dans le schema, mais on ajoute tenantId pour
    // garantir zéro fuite si l'invariant user↔tenant change (multi-tenant user).
    const existing = await this.prisma.notificationPreference.findFirst({
      where: { tenantId, userId },
    });
    if (existing) return existing;
    // Defaults alignés sur le schema Prisma — pas de magic number.
    return {
      id:       null,
      userId,
      tenantId,
      sms:      true,
      whatsapp: true,
      push:     true,
      email:    false,
    };
  }

  /**
   * Upsert des préférences. Sécurité : on contraint TOUJOURS le tenantId
   * + userId fournis (le service ne fait jamais confiance à un payload
   * pour identifier l'utilisateur — c'est l'appelant qui injecte).
   */
  async upsertPreferences(
    tenantId: string,
    userId:   string,
    patch:    Partial<{ sms: boolean; whatsapp: boolean; push: boolean; email: boolean }>,
  ) {
    // Security : on vérifie le tenant propriétaire avant update pour bloquer
    // toute tentative de modif cross-tenant via un userId d'un autre tenant.
    const existing = await this.prisma.notificationPreference.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });

    if (existing) {
      return this.prisma.notificationPreference.update({
        where: { id: existing.id },
        data:  patch,
      });
    }

    return this.prisma.notificationPreference.create({
      data: {
        userId,
        tenantId,
        sms:      patch.sms      ?? true,
        whatsapp: patch.whatsapp ?? true,
        push:     patch.push     ?? true,
        email:    patch.email    ?? false,
      },
    });
  }
}
