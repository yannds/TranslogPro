/**
 * LifecycleNotificationListener — fan-out multi-canal des notifications
 * voyageur sur les 5 évènements clés du cycle de vie d'un voyage :
 *
 *   1. ticket.issued          → confirmation d'achat
 *   2. trip.published         → ouverture du trajet à la vente (CRM-aware)
 *   3. trip.boarding.opened   → embarquement ouvert (passagers du trip)
 *   4. trip.reminder.due      → rappels pré-voyage T-Xh (cron)
 *   5. trip.completed         → arrivée + remerciement
 *
 * Architecture :
 *   - Subscribe via IEventBus (pattern Outbox) — pas EventEmitter @OnEvent
 *     car les events métier ne sont publiés QUE via Outbox.
 *   - Multi-canal : pour chaque destinataire on tente WhatsApp puis SMS
 *     (sendWithChannelFallback) + Email si email présent + IN_APP persisté.
 *   - i18n : on utilise customer.language puis tenant.language puis 'fr'.
 *   - Idempotency : la table Notification a un index sur metadata
 *     (tenantId + templateId + tripId + threshold) consulté par le scheduler.
 *   - Killswitch : `notifications.lifecycle.enabled` (PlatformConfig) pour
 *     couper le fan-out global en cas d'incident provider.
 *
 * Sécurité :
 *   - tenantId est pris UNIQUEMENT depuis l'event (jamais depuis le payload
 *     manipulable). Toutes les requêtes Prisma posent tenantId en racine.
 *   - Limite de fan-out par trip via PlatformConfig pour bloquer un emballement.
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
import { renderLifecycleTemplate, LifecycleTemplateId } from './lifecycle-templates';

interface Recipient {
  userId?:   string | null;
  phone?:    string | null;
  email?:    string | null;
  name?:     string | null;
  language?: string | null;
}

interface TripContext {
  tripId:             string;
  routeName:          string;
  origin:             string;
  destination:        string;
  scheduledIso:       string;
  scheduledHHMM:      string;
  scheduledDateLong:  string;
}

@Injectable()
export class LifecycleNotificationListener implements OnModuleInit {
  private readonly logger = new Logger(LifecycleNotificationListener.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly notifications: NotificationService,
    private readonly platformConfig: PlatformConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(EventTypes.TICKET_ISSUED,         (e) => this.onTicketIssued(e));
    this.eventBus.subscribe(EventTypes.TRIP_PUBLISHED,        (e) => this.onTripPublished(e));
    this.eventBus.subscribe(EventTypes.TRIP_BOARDING_OPENED,  (e) => this.onTripBoardingOpened(e));
    this.eventBus.subscribe(EventTypes.TRIP_REMINDER_DUE,     (e) => this.onTripReminderDue(e));
    this.eventBus.subscribe(EventTypes.TRIP_COMPLETED,        (e) => this.onTripCompleted(e));
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async onTicketIssued(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const payload    = event.payload as { ticketId?: string; tripId?: string };
    const ticketId   = payload.ticketId ?? event.aggregateId;
    const tenantId   = event.tenantId;

    try {
      const ticket = await this.prisma.ticket.findFirst({
        where: { id: ticketId, tenantId },
        select: {
          id: true, tripId: true,
          passengerName: true, passengerPhone: true, passengerEmail: true,
          customerId: true, pricePaid: true,
          customer: { select: { language: true, userId: true } },
        },
      });
      if (!ticket) {
        this.logger.debug(`[Lifecycle] ticket ${ticketId} introuvable (tenant ${tenantId})`);
        return;
      }
      const trip = await this.loadTrip(tenantId, ticket.tripId);
      if (!trip) return;

      const ctx       = this.buildTripContext(trip);
      const recipient: Recipient = {
        userId:   ticket.customer?.userId ?? null,
        phone:    ticket.passengerPhone,
        email:    ticket.passengerEmail,
        name:     ticket.passengerName,
        language: ticket.customer?.language ?? null,
      };

      await this.dispatchLifecycle({
        tenantId,
        templateId: 'notif.ticket.purchased',
        recipient,
        ctx,
        extraVars:  { ticketId: ticket.id, price: String(ticket.pricePaid ?? 0) },
        metadata:   { ticketId: ticket.id, tripId: trip.id },
      });
    } catch (err) {
      this.logger.error(
        `[Lifecycle] onTicketIssued failed (ticket=${ticketId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Ouverture du trajet à la vente. Pour ne pas spammer toute la base, on
   * cible UNIQUEMENT les Customer ayant déjà voyagé sur cette route (segment
   * FREQUENT ou totalTickets > 0 sur la route). C'est un canal "lead warm",
   * pas une campagne.
   */
  private async onTripPublished(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;

    const payload  = event.payload as { tripId?: string };
    const tripId   = payload.tripId ?? event.aggregateId;
    const tenantId = event.tenantId;

    try {
      const trip = await this.loadTrip(tenantId, tripId);
      if (!trip) return;

      const ctx = this.buildTripContext(trip);

      // Cible les customers qui ont déjà voyagé sur cette route (route_id via
      // boardingStation OU alightingStation OU customer.preferences.favoriteRoute).
      // Pour rester simple et borné : on prend les Customers FREQUENT/VIP du
      // tenant ayant un phone vérifié (pas de pollution CRM).
      const limit = await this.platformConfig.getNumber('notifications.reminders.maxRecipientsPerTrip');
      const customers = await this.prisma.customer.findMany({
        where: {
          tenantId,
          phoneVerified: true,
          phoneE164:     { not: null },
          OR: [
            { segments: { has: 'FREQUENT' } },
            { segments: { has: 'VIP' } },
          ],
        },
        select: {
          phoneE164: true, email: true, name: true, language: true,
          userId: true,
        },
        take: limit,
      });

      this.logger.log(
        `[Lifecycle TRIP_PUBLISHED] trip=${tripId} fan-out=${customers.length} (FREQUENT/VIP only)`,
      );

      for (const c of customers) {
        await this.dispatchLifecycle({
          tenantId,
          templateId: 'notif.trip.published',
          recipient: {
            userId:   c.userId,
            phone:    c.phoneE164,
            email:    c.email,
            name:     c.name,
            language: c.language,
          },
          ctx,
          metadata: { tripId, broadcast: 'trip.published' },
        });
      }
    } catch (err) {
      this.logger.error(
        `[Lifecycle] onTripPublished failed (trip=${tripId}): ${(err as Error).message}`,
      );
    }
  }

  private async onTripBoardingOpened(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;
    await this.fanOutToTripPassengers(event, 'notif.trip.boarding');
  }

  private async onTripCompleted(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;
    await this.fanOutToTripPassengers(event, 'notif.trip.arrived');
  }

  /**
   * Émis par TripReminderScheduler avec payload {tripId, hoursThreshold}.
   * Fan-out aux détenteurs de billets actifs (CONFIRMED/CHECKED_IN).
   */
  private async onTripReminderDue(event: DomainEvent): Promise<void> {
    if (!(await this.lifecycleEnabled())) return;
    const payload = event.payload as { tripId?: string; hoursThreshold?: number };
    if (typeof payload?.hoursThreshold !== 'number') {
      this.logger.warn(`[Lifecycle TRIP_REMINDER_DUE] missing hoursThreshold — skipped`);
      return;
    }
    await this.fanOutToTripPassengers(event, 'notif.trip.reminder', {
      hoursThreshold: String(payload.hoursThreshold),
    });
  }

  // ─── Fan-out helper ─────────────────────────────────────────────────────

  private async fanOutToTripPassengers(
    event:      DomainEvent,
    templateId: LifecycleTemplateId,
    extraVars?: Record<string, string>,
  ): Promise<void> {
    const payload  = event.payload as { tripId?: string };
    const tripId   = payload.tripId ?? event.aggregateId;
    const tenantId = event.tenantId;

    try {
      const trip = await this.loadTrip(tenantId, tripId);
      if (!trip) {
        this.logger.debug(`[Lifecycle ${event.type}] trip ${tripId} introuvable`);
        return;
      }

      const ctx     = this.buildTripContext(trip);
      const maxRcpt = await this.platformConfig.getNumber('notifications.reminders.maxRecipientsPerTrip');

      // Tickets actifs au moment du fan-out (CONFIRMED, CHECKED_IN, BOARDED).
      // On exclut CANCELLED/EXPIRED/REFUNDED pour ne pas notifier inutilement.
      const tickets = await this.prisma.ticket.findMany({
        where: {
          tenantId,
          tripId,
          status: { in: ['CONFIRMED', 'CHECKED_IN', 'BOARDED'] },
        },
        select: {
          id: true, passengerName: true, passengerPhone: true, passengerEmail: true,
          customer: { select: { language: true, userId: true } },
        },
        take: maxRcpt,
      });

      this.logger.log(
        `[Lifecycle ${event.type}] trip=${tripId} fan-out=${tickets.length}`,
      );

      for (const t of tickets) {
        await this.dispatchLifecycle({
          tenantId,
          templateId,
          recipient: {
            userId:   t.customer?.userId ?? null,
            phone:    t.passengerPhone,
            email:    t.passengerEmail,
            name:     t.passengerName,
            language: t.customer?.language ?? null,
          },
          ctx,
          extraVars,
          metadata: {
            tripId,
            ticketId: t.id,
            ...(extraVars ?? {}),
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `[Lifecycle ${event.type}] fan-out failed (trip=${tripId}): ${(err as Error).message}`,
      );
    }
  }

  // ─── Dispatch multi-canal pour un destinataire ──────────────────────────

  private async dispatchLifecycle(opts: {
    tenantId:   string;
    templateId: LifecycleTemplateId;
    recipient:  Recipient;
    ctx:        TripContext;
    extraVars?: Record<string, string>;
    metadata:   Record<string, string>;
  }): Promise<void> {
    const { tenantId, templateId, recipient, ctx, extraVars, metadata } = opts;

    // 1. Résoudre la langue : recipient → tenant → 'fr'
    const lang = await this.resolveLanguage(tenantId, recipient.language);

    // 2. Render template
    const rendered = renderLifecycleTemplate(templateId, lang, {
      ...ctx,
      passengerName: recipient.name ?? '',
      ...(extraVars ?? {}),
    });

    // 3. IN_APP toujours persisté si userId connu (lecture portail "Mes notifs")
    if (recipient.userId) {
      await this.notifications.send({
        tenantId,
        userId:   recipient.userId,
        channel:  'IN_APP',
        templateId,
        title:    rendered.title,
        body:     rendered.body,
        metadata,
      });
    }

    // 4. WhatsApp → SMS fallback (uniquement si phone disponible)
    if (recipient.phone) {
      await this.notifications.sendWithChannelFallback({
        tenantId,
        phone:      recipient.phone,
        templateId,
        title:      rendered.title,
        body:       rendered.body,
        metadata,
      });
    }

    // 5. Email — uniquement si email présent (la prefs.email check est fait par
    //    NotificationService.send via NotificationPreference si userId).
    if (recipient.email) {
      await this.notifications.send({
        tenantId,
        userId:   recipient.userId ?? undefined,
        email:    recipient.email,
        channel:  'EMAIL',
        templateId,
        title:    rendered.title,
        body:     rendered.body,
        html:     rendered.html,
        metadata,
      });
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async loadTrip(tenantId: string, tripId: string) {
    return this.prisma.trip.findFirst({
      where: { id: tripId, tenantId },
      select: {
        id: true,
        departureScheduled: true,
        route: {
          select: {
            name:        true,
            origin:      { select: { city: true, name: true } },
            destination: { select: { city: true, name: true } },
          },
        },
      },
    });
  }

  private buildTripContext(
    trip: {
      id: string;
      departureScheduled: Date;
      route: {
        name:        string;
        origin:      { city: string | null; name: string };
        destination: { city: string | null; name: string };
      };
    },
  ): TripContext {
    const iso  = trip.departureScheduled.toISOString();
    const hhmm = iso.slice(11, 16);
    const dateLong = trip.departureScheduled.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    return {
      tripId:            trip.id,
      routeName:         trip.route.name,
      origin:            trip.route.origin.city || trip.route.origin.name,
      destination:       trip.route.destination.city || trip.route.destination.name,
      scheduledIso:      iso,
      scheduledHHMM:     hhmm,
      scheduledDateLong: dateLong,
    };
  }

  private async resolveLanguage(
    tenantId:    string,
    customerLang: string | null | undefined,
  ): Promise<'fr' | 'en'> {
    if (customerLang === 'fr' || customerLang === 'en') return customerLang;
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
      // En cas d'erreur PlatformConfig, on ne bloque PAS le listener — on log
      // mais on continue (le default registry est `true`).
      return true;
    }
  }
}
