/**
 * TripCancelledNotificationListener — fan-out aux porteurs de billets actifs
 * lors de l'annulation d'un trajet (TRIP_CANCELLED).
 *
 * Coexiste avec :
 *   - RefundTripListener (sav)              → crée les refunds
 *   - AnnouncementTripListener (announcement) → publie une annonce gare
 *   - Ce listener (notification)            → notifie les voyageurs
 *
 * Pas de risque de doublon : chaque listener traite une responsabilité distincte.
 */

import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IEventBus, EVENT_BUS, DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from './notification.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { renderTripTemplate } from './email-templates/trip-templates';

@Injectable()
export class TripCancelledNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(TripCancelledNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.TRIP_CANCELLED, (e) => this.onTripCancelled(e));
  }

  private async onTripCancelled(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const tenantId = event.tenantId;
    const tripId   = (event.payload as { tripId?: string }).tripId ?? event.aggregateId;
    const reason   = (event.payload as { reason?: string }).reason ?? '';

    try {
      const trip = await this.prisma.trip.findFirst({
        where: { id: tripId, tenantId },
        select: {
          id: true, departureScheduled: true,
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
        this.logger.debug(`[Trip TRIP_CANCELLED] trip ${tripId} introuvable (tenant ${tenantId})`);
        return;
      }

      const maxRcpt = await this.platformConfig.getNumber('notifications.reminders.maxRecipientsPerTrip');
      const tickets = await this.prisma.ticket.findMany({
        where: {
          tenantId, tripId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] },
        },
        select: {
          id: true, passengerName: true, passengerPhone: true, passengerEmail: true,
          customer: { select: { language: true, userId: true } },
        },
        take: maxRcpt,
      });

      this.logger.log(`[Trip TRIP_CANCELLED] trip=${tripId} fan-out=${tickets.length}`);

      const iso  = trip.departureScheduled.toISOString();
      const hhmm = iso.slice(11, 16);

      for (const t of tickets) {
        const lang = await this.resolveLanguage(tenantId, t.customer?.language ?? null);
        const dateLong = trip.departureScheduled.toLocaleDateString(
          lang === 'en' ? 'en-GB' : 'fr-FR',
          { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
        );
        const out = renderTripTemplate('trip.cancelled', lang, {
          passengerName:     t.passengerName,
          routeName:         trip.route.name,
          origin:            trip.route.origin.city || trip.route.origin.name,
          destination:       trip.route.destination.city || trip.route.destination.name,
          scheduledDateLong: dateLong,
          scheduledHHMM:     hhmm,
          reason,
        });
        const meta = { tripId, ticketId: t.id };

        if (t.customer?.userId) {
          await this.notifications.send({
            tenantId, userId: t.customer.userId, channel: 'IN_APP',
            templateId: 'trip.cancelled', title: out.title, body: out.body, metadata: meta,
          });
        }
        if (t.passengerPhone) {
          await this.notifications.sendWithChannelFallback({
            tenantId, phone: t.passengerPhone, templateId: 'trip.cancelled',
            title: out.title, body: out.body, metadata: meta,
          });
        }
        if (t.passengerEmail) {
          await this.notifications.send({
            tenantId, userId: t.customer?.userId ?? undefined,
            email: t.passengerEmail, channel: 'EMAIL', templateId: 'trip.cancelled',
            title: out.title, body: out.body, html: out.html, metadata: meta,
          });
        }
      }
    } catch (err) {
      this.logger.error(`[Trip TRIP_CANCELLED] dispatch failed (trip=${tripId}): ${(err as Error).message}`);
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
