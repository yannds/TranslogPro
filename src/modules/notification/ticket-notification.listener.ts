/**
 * TicketNotificationListener — fan-out multi-canal sur les events
 * TICKET_NO_SHOW / TICKET_REBOOKED / TICKET_FORFEITED.
 *
 * Pour TICKET_REBOOKED : le payload référence newTripId — on charge ce trip
 * pour pouvoir indiquer le nouveau départ dans le mail.
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus, EVENT_BUS, DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { renderTicketTemplate, TicketTemplateId } from './email-templates/ticket-templates';

@Injectable()
export class TicketNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(TicketNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.TICKET_NO_SHOW,   (e) => this.handle(e, 'ticket.no_show'));
    this.eventBus.subscribe(EventTypes.TICKET_REBOOKED,  (e) => this.handle(e, 'ticket.rebooked'));
    this.eventBus.subscribe(EventTypes.TICKET_FORFEITED, (e) => this.handle(e, 'ticket.forfeited'));
  }

  private async handle(event: DomainEvent, templateId: TicketTemplateId): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId = event.tenantId;
    const ticketId = (event.payload as { ticketId?: string }).ticketId ?? event.aggregateId;
    const newTripId = (event.payload as { newTripId?: string }).newTripId;

    try {
      // Ticket et Trip n'ont pas de relation Prisma directe → 2 lookups séparés.
      const ticket = await this.prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
        select: {
          id: true, tripId: true,
          passengerName: true, passengerPhone: true, passengerEmail: true,
          customer: { select: { language: true, userId: true } },
        },
      });
      if (!ticket) {
        this.logger.debug(`[Ticket ${event.type}] ticket introuvable (ticket=${ticketId})`);
        return;
      }

      const trip = await this.prisma.trip.findFirst({
        where: { id: ticket.tripId, tenantId },
        select: {
          departureScheduled: true,
          route: {
            select: {
              name: true,
              origin:      { select: { city: true, name: true } },
              destination: { select: { city: true, name: true } },
            },
          },
        },
      });
      if (!trip) {
        this.logger.debug(`[Ticket ${event.type}] trip ${ticket.tripId} introuvable`);
        return;
      }

      // Nouveau trip pour rebook : on charge si newTripId présent.
      let newTrip: { departureScheduled: Date } | null = null;
      if (newTripId) {
        newTrip = await this.prisma.trip.findFirst({
          where: { id: newTripId, tenantId },
          select: { departureScheduled: true },
        });
      }

      const lang = await this.resolveLanguage(tenantId, ticket.customer?.language ?? null);
      const ttlHours = await this.platformConfig.getNumber('ticket.ttlHours').catch(() => 48);
      const out = renderTicketTemplate(templateId, lang, {
        passengerName:        ticket.passengerName,
        ticketRef:            ticket.id,
        routeName:            trip.route.name,
        origin:               trip.route.origin.city || trip.route.origin.name,
        destination:          trip.route.destination.city || trip.route.destination.name,
        scheduledDateLong:    formatDateLong(trip.departureScheduled, lang),
        newScheduledDateLong: newTrip ? formatDateLong(newTrip.departureScheduled, lang) : '',
        newScheduledHHMM:     newTrip ? newTrip.departureScheduled.toISOString().slice(11, 16) : '',
        ttlHours:             String(ttlHours),
        rebookUrl:            '', // bouton non rendu pour V1
      });
      const meta = { ticketId: ticket.id, tripId: ticket.tripId, ...(newTripId ? { newTripId } : {}) };

      if (ticket.customer?.userId) {
        await this.notifications.send({
          tenantId, userId: ticket.customer.userId, channel: 'IN_APP',
          templateId, title: out.title, body: out.body, metadata: meta,
        });
      }
      if (ticket.passengerPhone) {
        await this.notifications.sendWithChannelFallback({
          tenantId, phone: ticket.passengerPhone, templateId,
          title: out.title, body: out.body, metadata: meta,
        });
      }
      if (ticket.passengerEmail) {
        await this.notifications.send({
          tenantId, userId: ticket.customer?.userId ?? undefined,
          email: ticket.passengerEmail, channel: 'EMAIL', templateId,
          title: out.title, body: out.body, html: out.html, metadata: meta,
        });
      }
    } catch (err) {
      this.logger.error(`[Ticket ${event.type}] dispatch failed (ticket=${ticketId}): ${(err as Error).message}`);
    }
  }

  private async resolveLanguage(tenantId: string, lang: string | null): Promise<'fr' | 'en'> {
    if (lang === 'fr' || lang === 'en') return lang;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { language: true } });
    return tenant?.language === 'en' ? 'en' : 'fr';
  }

  private async lifecycleEnabled(): Promise<boolean> {
    try { return await this.platformConfig.getBoolean('notifications.lifecycle.enabled'); }
    catch { return true; }
  }
}

function formatDateLong(d: Date, lang: 'fr' | 'en'): string {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
