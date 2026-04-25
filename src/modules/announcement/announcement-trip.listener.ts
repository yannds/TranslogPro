/**
 * AnnouncementTripListener — génère automatiquement des annonces gare
 * à partir des événements du cycle de vie Trip + Incident.
 *
 * Idempotent : chaque DomainEvent est identifié par son `id`, persisté en
 * `Announcement.sourceEventId` avec contrainte unique (tenantId, sourceEventId).
 * Les retries de l'outbox ne créent pas de doublons.
 *
 * Source de vérité : les auto-annonces cohabitent avec les annonces manuelles
 * (CRUD admin `/admin/display/announcements`). `source = 'AUTO' | 'MANUAL'`.
 */
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { AnnouncementService } from './announcement.service';

type AnnouncementKind = 'BOARDING' | 'DELAY' | 'CANCELLATION' | 'ARRIVAL' | 'SUSPENSION' | 'SECURITY';

const PRIORITY: Record<AnnouncementKind, number> = {
  BOARDING:     5,
  DELAY:        7,
  CANCELLATION: 9,
  ARRIVAL:      3,
  SUSPENSION:   7,
  SECURITY:     10,
};

const DEFAULT_TTL_MIN: Record<AnnouncementKind, number> = {
  BOARDING:     30,
  DELAY:        120,
  CANCELLATION: 240,
  ARRIVAL:      15,
  SUSPENSION:   60,
  SECURITY:     120,
};

type TemplateFn = (trip: TripInfo) => string;
interface TripInfo {
  routeName: string;
  origin:    string;
  destination: string;
  scheduled: string; // HH:MM
}

const TEMPLATES: Record<AnnouncementKind, { fr: { title: TemplateFn; message: TemplateFn }; en: { title: TemplateFn; message: TemplateFn } }> = {
  BOARDING: {
    fr: {
      title:   (t) => `Embarquement : ${t.routeName}`,
      message: (t) => `Embarquement ouvert pour le trajet ${t.origin} → ${t.destination} (départ prévu ${t.scheduled}). Merci de rejoindre votre quai.`,
    },
    en: {
      title:   (t) => `Boarding : ${t.routeName}`,
      message: (t) => `Boarding is now open for ${t.origin} → ${t.destination} (scheduled ${t.scheduled}). Please proceed to your platform.`,
    },
  },
  DELAY: {
    fr: {
      title:   (t) => `Retard : ${t.routeName}`,
      message: (t) => `Le trajet ${t.origin} → ${t.destination} prévu à ${t.scheduled} est retardé. Une nouvelle estimation sera communiquée.`,
    },
    en: {
      title:   (t) => `Delay : ${t.routeName}`,
      message: (t) => `Trip ${t.origin} → ${t.destination} scheduled ${t.scheduled} is delayed. An updated ETA will be announced.`,
    },
  },
  CANCELLATION: {
    fr: {
      title:   (t) => `Annulation : ${t.routeName}`,
      message: (t) => `Le trajet ${t.origin} → ${t.destination} prévu à ${t.scheduled} est annulé. Merci de vous présenter au guichet pour remboursement ou remplacement.`,
    },
    en: {
      title:   (t) => `Cancellation : ${t.routeName}`,
      message: (t) => `Trip ${t.origin} → ${t.destination} scheduled ${t.scheduled} is cancelled. Please proceed to the counter for refund or rebooking.`,
    },
  },
  ARRIVAL: {
    fr: {
      title:   (t) => `Arrivée : ${t.routeName}`,
      message: (t) => `Le véhicule du trajet ${t.origin} → ${t.destination} est arrivé à destination.`,
    },
    en: {
      title:   (t) => `Arrival : ${t.routeName}`,
      message: (t) => `Vehicle for trip ${t.origin} → ${t.destination} has reached its destination.`,
    },
  },
  SUSPENSION: {
    fr: {
      title:   (t) => `Trajet suspendu : ${t.routeName}`,
      message: (t) => `Le trajet ${t.origin} → ${t.destination} est momentanément suspendu. Restez à proximité du quai pour la reprise.`,
    },
    en: {
      title:   (t) => `Trip suspended : ${t.routeName}`,
      message: (t) => `Trip ${t.origin} → ${t.destination} is temporarily suspended. Please remain near your platform.`,
    },
  },
  SECURITY: {
    fr: {
      title:   (_t) => `Alerte sécurité`,
      message: (_t) => `Un incident de sécurité est signalé. Suivez les instructions du personnel de la gare.`,
    },
    en: {
      title:   (_t) => `Security alert`,
      message: (_t) => `A security incident has been reported. Please follow station staff instructions.`,
    },
  },
};

@Injectable()
export class AnnouncementTripListener implements OnModuleInit {
  private readonly logger = new Logger(AnnouncementTripListener.name);

  constructor(
    private readonly prisma:         PrismaService,
    private readonly announcements:  AnnouncementService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  onModuleInit() {
    // BOARDING gare diffusée à l'ouverture d'embarquement (TRIP_BOARDING_OPENED).
    // TRIP_STARTED reste pour le départ effectif → pas d'announcement gare distincte
    // (le quai est libéré, plus utile).
    this.eventBus.subscribe(EventTypes.TRIP_BOARDING_OPENED, (e) => this.onTripEvent(e, 'BOARDING'));
    this.eventBus.subscribe(EventTypes.TRIP_DELAYED,   (e) => this.onTripEvent(e, 'DELAY'));
    this.eventBus.subscribe(EventTypes.TRIP_CANCELLED, (e) => this.onTripEvent(e, 'CANCELLATION'));
    this.eventBus.subscribe(EventTypes.TRIP_COMPLETED, (e) => this.onTripEvent(e, 'ARRIVAL'));
    this.eventBus.subscribe(EventTypes.TRIP_PAUSED,    (e) => this.onTripEvent(e, 'SUSPENSION'));
    this.eventBus.subscribe(EventTypes.INCIDENT_SOS,   (e) => this.onIncidentSos(e));
  }

  private async onTripEvent(event: DomainEvent, kind: Exclude<AnnouncementKind, 'SECURITY'>): Promise<void> {
    const tenantId = event.tenantId;
    const tripId   = (event.payload as { tripId?: string })?.tripId ?? event.aggregateId;

    try {
      const trip = await this.prisma.trip.findFirst({
        where:  { id: tripId, tenantId },
        include: {
          route: {
            include: {
              origin:      { select: { city: true, name: true } },
              destination: { select: { city: true, name: true } },
            },
          },
        },
      });
      if (!trip) {
        this.logger.debug(`[Announcement] ${event.type} ignoré : trip ${tripId} introuvable (tenant ${tenantId})`);
        return;
      }

      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { language: true },
      });
      const lang = (tenant?.language === 'en' ? 'en' : 'fr') as 'fr' | 'en';

      const tpl     = TEMPLATES[kind][lang];
      const info: TripInfo = {
        routeName:   trip.route.name,
        origin:      trip.route.origin.city || trip.route.origin.name,
        destination: trip.route.destination.city || trip.route.destination.name,
        scheduled:   trip.departureScheduled.toISOString().slice(11, 16),
      };

      await this.announcements.createAuto(tenantId, {
        type:          kind,
        priority:      PRIORITY[kind],
        title:         tpl.title(info),
        message:       tpl.message(info),
        tripId:        trip.id,
        // Annonce scopée sur la gare d'origine : les voyageurs à la gare de
        // départ sont les premiers concernés. `stationId = null` diffuserait à
        // toutes les gares du tenant (admissible mais bruité).
        stationId:     trip.route.originId,
        sourceEventId: event.id,
        endsAt:        new Date(Date.now() + DEFAULT_TTL_MIN[kind] * 60_000),
      });

      this.logger.log(`[Announcement AUTO ${kind}] trip=${trip.id} tenant=${tenantId}`);
    } catch (err) {
      this.logger.error(
        `[Announcement] ${event.type} handler failed (trip=${tripId}): ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async onIncidentSos(event: DomainEvent): Promise<void> {
    const tenantId = event.tenantId;
    const payload  = event.payload as { tripId?: string; stationId?: string };

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { language: true },
      });
      const lang = (tenant?.language === 'en' ? 'en' : 'fr') as 'fr' | 'en';
      const tpl  = TEMPLATES['SECURITY'][lang];

      // Pas de trip spécifique nécessaire — annonce de sécurité diffuse.
      const emptyInfo: TripInfo = { routeName: '', origin: '', destination: '', scheduled: '' };

      await this.announcements.createAuto(tenantId, {
        type:          'SECURITY',
        priority:      PRIORITY['SECURITY'],
        title:         tpl.title(emptyInfo),
        message:       tpl.message(emptyInfo),
        tripId:        payload.tripId ?? null,
        stationId:     payload.stationId ?? null,
        sourceEventId: event.id,
        endsAt:        new Date(Date.now() + DEFAULT_TTL_MIN['SECURITY'] * 60_000),
      });

      this.logger.warn(`[Announcement AUTO SECURITY] tenant=${tenantId} incident event=${event.id}`);
    } catch (err) {
      this.logger.error(
        `[Announcement] INCIDENT_SOS handler failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
