/**
 * PublicPortalService — Logique métier pour le portail public voyageur.
 *
 * Toutes les requêtes sont scoped par tenantSlug (résolu en tenantId).
 * Aucune donnée sensible n'est exposée (pas d'IDs internes, pas de
 * données financières, pas de données personnelles d'autres utilisateurs).
 */
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService }   from '../../infrastructure/database/prisma.service';
import { WhiteLabelService } from '../white-label/white-label.service';
import { QrService }        from '../../core/security/qr/qr.service';
import { DocumentsService } from '../documents/documents.service';
import { CancellationPolicyService } from '../sav/cancellation-policy.service';
import { RefundService }    from '../sav/refund.service';
import { RefundReason, ParcelState }     from '../../common/constants/workflow-states';
import { REDIS_CLIENT }     from '../../infrastructure/eventbus/redis-publisher.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { NotificationService } from '../notification/notification.service';
import { CustomerResolverService } from '../crm/customer-resolver.service';
import { CustomerClaimService }    from '../crm/customer-claim.service';
import { AnnouncementService }     from '../announcement/announcement.service';
import { v4 as uuidv4 } from 'uuid';
import {
  RouteSnapshot,
  resolveSegmentPriceFromSnapshot,
  stationDistanceOnRoute,
} from '../../core/pricing/segment-price.helper';

const PORTAL_CACHE_TTL = 300; // 5 min

@Injectable()
export class PublicPortalService {
  private readonly logger = new Logger(PublicPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brandService: WhiteLabelService,
    private readonly qrService: QrService,
    private readonly documentsService: DocumentsService,
    private readonly policyService: CancellationPolicyService,
    private readonly refundService: RefundService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly notification: NotificationService,
    private readonly crmResolver: CustomerResolverService,
    private readonly crmClaim:    CustomerClaimService,
    private readonly announcements: AnnouncementService,
  ) {}

  // ─── Annonces publiques ───────────────────────────────────────────────────

  /**
   * Retourne les annonces actives pour le tenant (+ station optionnelle).
   * Filtrage serveur : seules les champs publics sont exposés (pas de createdById
   * ni sourceEventId — fuite d'info interne potentielle).
   */
  async getPublicAnnouncements(slug: string, stationId?: string) {
    const tenant = await this.resolveTenant(slug);
    const rows = await this.announcements.findAll(tenant.id, stationId, /* activeOnly */ true);
    return rows.map(a => ({
      id:        a.id,
      type:      a.type,
      priority:  a.priority,
      title:     a.title,
      message:   a.message,
      stationId: a.stationId,
      tripId:    a.tripId,
      startsAt:  a.startsAt.toISOString(),
      endsAt:    a.endsAt ? a.endsAt.toISOString() : null,
      station:   a.station,
      source:    a.source,
    }));
  }

  // ─── Tenant resolution ────────────────────────────────────────────────────

  /** Resolve tenant slug to tenant ID. Cached in Redis (5 min).
   *
   * Sécurité cache : `portal:slug:${slug}` est safe car `Tenant.slug` est
   * globally unique (contrainte Prisma @unique). Pas de collision cross-tenant
   * possible. Pas de préfixe tenantId nécessaire — le slug EST l'identifiant
   * tenant pour ce lookup public.
   */
  async resolveTenant(slug: string) {
    const cacheKey = `portal:slug:${slug}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true, name: true, slug: true,
        country: true, language: true, currency: true,
        timezone: true, phoneNumber: true, email: true,
        website: true, address: true, city: true,
        isActive: true, provisionStatus: true,
      },
    });
    if (!tenant || !tenant.isActive || tenant.provisionStatus !== 'ACTIVE') {
      throw new NotFoundException('Company not found');
    }

    const result = {
      id: tenant.id, name: tenant.name, slug: tenant.slug,
      country: tenant.country, language: tenant.language,
      currency: tenant.currency, timezone: tenant.timezone,
      city: tenant.city,
      contact: {
        phone: tenant.phoneNumber,
        email: tenant.email,
        website: tenant.website,
        address: tenant.address,
      },
    };

    await this.redis.setex(cacheKey, PORTAL_CACHE_TTL, JSON.stringify(result));
    return result;
  }

  // ─── Portal config (brand + portal settings) ──────────────────────────────

  async getPortalConfig(tenantSlug: string) {
    const tenant = await this.resolveTenant(tenantSlug);
    const brand = await this.brandService.getBrand(tenant.id);

    const portalConfig = await this.prisma.tenantPortalConfig.findUnique({
      where: { tenantId: tenant.id },
    });

    // Payment methods for this tenant's country
    const paymentMethods = await this.prisma.paymentMethodConfig.findMany({
      where: { countryCode: tenant.country, enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        providerId: true, displayName: true, type: true,
        logoUrl: true, phonePrefix: true,
      },
    });

    // If no custom brand configured, use tenant name instead of generic "TranslogPro"
    const resolvedBrand = {
      ...brand,
      brandName: brand.brandName === 'TranslogPro' ? tenant.name : brand.brandName,
    };

    return {
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        country: tenant.country,
        language: tenant.language,
        currency: tenant.currency,
        timezone: tenant.timezone,
        city: tenant.city,
        contact: tenant.contact,
      },
      brand: resolvedBrand,
      portal: portalConfig ? {
        themeId:        portalConfig.themeId,
        showAbout:      portalConfig.showAbout,
        showFleet:      portalConfig.showFleet,
        showNews:       portalConfig.showNews,
        showContact:    portalConfig.showContact,
        newsCmsEnabled: portalConfig.newsCmsEnabled,
        heroImageUrl:   portalConfig.heroImageUrl,
        heroOverlay:    portalConfig.heroOverlay,
        slogans:        portalConfig.slogans,
        socialLinks:    portalConfig.socialLinks,
        ogImageUrl:     portalConfig.ogImageUrl,
      } : null,
      paymentMethods,
    };
  }

  // ─── Trip dates (calendar hints — public) ─────────────────────────────────

  /**
   * Returns an array of ISO date strings (YYYY-MM-DD) that have at least one
   * bookable trip for the given month. Used by the passenger calendar to
   * bold-highlight dates with available departures.
   *
   * @param month  Optional "YYYY-MM" string. Defaults to current month.
   */
  async getTripDates(tenantSlug: string, month?: string): Promise<string[]> {
    const tenant = await this.resolveTenant(tenantSlug);

    const now = new Date();
    const [y, m] = month
      ? month.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1];

    const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
    const end   = new Date(y, m, 0, 23, 59, 59, 999); // last day of month

    // Only return dates from today onwards (no past dates)
    const floor = now > start ? now : start;
    floor.setHours(0, 0, 0, 0);

    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        status:   { in: ['PLANNED', 'OPEN', 'BOARDING'] },
        departureScheduled: { gte: floor, lte: end },
      },
      select: { departureScheduled: true },
    });

    // Deduplicate by date string
    const dateSet = new Set(
      trips.map(t => t.departureScheduled.toISOString().slice(0, 10)),
    );

    return [...dateSet].sort();
  }

  // ─── Trip search (public) ─────────────────────────────────────────────────

  /**
   * Recherche de trajets publique, avec support des segments intermédiaires.
   *
   * Comportement :
   *   - `departure` / `arrival` peuvent désigner N'IMPORTE QUELLE gare sur la
   *     route (origine, waypoint ou destination), pas seulement l'OD complète.
   *   - Le service détermine les stations `boarding` et `alighting` en
   *     respectant l'ordre : alighting.order > boarding.order.
   *   - Politique tenant (`TenantBusinessConfig.intermediate*`) :
   *       · `intermediateBookingEnabled=false`       → n'expose que les trajets OD.
   *       · `intermediateBookingCutoffMins`          → bloque les segments si
   *         le bus part dans moins de N minutes (OD reste possible).
   *       · `intermediateMinSegmentMinutes`          → filtre les micro-segments.
   *       · `intermediateSegmentBlacklist`           → segments interdits.
   *   - Le prix retourné est celui du segment résolu (manuel si configuré,
   *     sinon proportionnel si `Route.allowProportionalFallback=true`).
   *
   * Aucun ID interne n'est exposé AU-DELÀ de ce qui est nécessaire au booking :
   * tripId (inchangé), boardingStationId / alightingStationId (pour que le
   * client les renvoie dans CreateBookingDto).
   */
  async searchTrips(tenantSlug: string, params: {
    departure: string;
    arrival: string;
    date: string;
    passengers?: number;
  }) {
    const tenant = await this.resolveTenant(tenantSlug);
    const pax = params.passengers ?? 1;
    const searchDate = new Date(params.date);

    // Build date range for the search day
    const dayStart = new Date(searchDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(searchDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Charge politique + frais choix siège
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: tenant.id },
      select: {
        seatSelectionFee:              true,
        intermediateBookingEnabled:    true,
        intermediateBookingCutoffMins: true,
        intermediateMinSegmentMinutes: true,
        intermediateSegmentBlacklist:  true,
      },
    });
    const seatSelectionFee              = bizConfig?.seatSelectionFee ?? 0;
    const interEnabled                  = bizConfig?.intermediateBookingEnabled ?? true;
    const cutoffMins                    = bizConfig?.intermediateBookingCutoffMins ?? 30;
    const minSegmentMins                = bizConfig?.intermediateMinSegmentMinutes ?? 0;
    const blacklist = Array.isArray(bizConfig?.intermediateSegmentBlacklist)
      ? bizConfig!.intermediateSegmentBlacklist as Array<{ routeId: string; fromStationId: string; toStationId: string }>
      : [];

    // Charge tous les trajets actifs du jour (pas de préfiltre SQL sur O-D —
    // on matche waypoints côté JS pour gérer les segments intermédiaires).
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        status:   { in: ['PLANNED', 'OPEN', 'BOARDING'] },
        departureScheduled: { gte: dayStart, lt: dayEnd },
      },
      include: {
        route: {
          include: {
            origin:        { select: { id: true, name: true, city: true } },
            destination:   { select: { id: true, name: true, city: true } },
            waypoints:     {
              orderBy: { order: 'asc' },
              include: { station: { select: { id: true, name: true, city: true } } },
            },
            segmentPrices: { select: { fromStationId: true, toStationId: true, basePriceXaf: true } },
          },
        },
        bus: {
          select: {
            model: true, type: true, capacity: true,
            seatLayout: true, photos: true, amenities: true,
          },
        },
      },
      orderBy: { departureScheduled: 'asc' },
      take: 50,
    });

    // Count occupied seats per trip (une seule requête agrégée)
    const tripIds = trips.map(t => t.id);
    const ticketCounts = tripIds.length > 0
      ? await this.prisma.ticket.groupBy({
          by: ['tripId'],
          where: { tenantId: tenant.id, tripId: { in: tripIds }, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
          _count: true,
        })
      : [];
    const countByTrip = new Map(ticketCounts.map(c => [c.tripId, c._count]));

    const depTerm = params.departure.trim().toLowerCase();
    const arrTerm = params.arrival.trim().toLowerCase();
    const nowMs   = Date.now();

    const results: unknown[] = [];

    for (const trip of trips) {
      // Construire la séquence complète des arrêts (origine + waypoints + destination)
      // triée par order. `order` pour origine = -1 conventionnellement (avant tous les waypoints),
      // et destination = maxWaypointOrder + 1.
      const stopsSeq = this.buildTripStopsSequence(trip);

      // Trouver boarding = première gare qui matche `departure`
      const boardingIdx = stopsSeq.findIndex(s => this.stopMatches(s, depTerm));
      if (boardingIdx === -1) continue;

      // Trouver alighting = première gare APRÈS boarding qui matche `arrival`
      const alightingIdx = stopsSeq.findIndex(
        (s, idx) => idx > boardingIdx && this.stopMatches(s, arrTerm),
      );
      if (alightingIdx === -1) continue;

      const boarding  = stopsSeq[boardingIdx];
      const alighting = stopsSeq[alightingIdx];

      const isFullOD = boarding.stationId === trip.route.originId
                    && alighting.stationId === trip.route.destinationId;

      // Politique : si les segments intermédiaires sont désactivés, on ne garde
      // que les trajets OD complets.
      if (!interEnabled && !isFullOD) continue;

      // Politique cut-off (seulement pour segments intermédiaires)
      const departureMs = trip.departureScheduled.getTime();
      if (!isFullOD && departureMs - nowMs < cutoffMins * 60_000) continue;

      // Black-list
      const blacklisted = blacklist.some(b =>
        b.routeId === trip.route.id &&
        b.fromStationId === boarding.stationId &&
        b.toStationId === alighting.stationId,
      );
      if (blacklisted) continue;

      // Segment min minutes (estimé proportionnel à la durée totale)
      const boardingEst  = this.estimateStopTime(trip, boarding);
      const alightingEst = this.estimateStopTime(trip, alighting);
      const segmentMins  = (alightingEst.getTime() - boardingEst.getTime()) / 60_000;
      if (!isFullOD && segmentMins < minSegmentMins) continue;

      // Résolution prix du segment via helper partagé
      const routeSnap: RouteSnapshot = {
        basePrice:                 trip.route.basePrice,
        distanceKm:                trip.route.distanceKm,
        allowProportionalFallback: trip.route.allowProportionalFallback,
        originId:                  trip.route.originId,
        destinationId:             trip.route.destinationId,
        waypoints: trip.route.waypoints.map(w => ({
          stationId:            w.stationId,
          distanceFromOriginKm: w.distanceFromOriginKm,
          tollCostXaf:          w.tollCostXaf,
          checkpointCosts:      w.checkpointCosts as unknown,
          order:                w.order,
        })),
      };
      const priced = resolveSegmentPriceFromSnapshot(
        routeSnap,
        boarding.stationId,
        alighting.stationId,
        trip.route.segmentPrices,
      );
      if (priced.blocked) continue; // tarif non résoluble → exclure du listing

      // Capacité / places
      const seatLayout = trip.bus?.seatLayout as { rows: number; cols: number; aisleAfter?: number; disabled?: string[] } | null;
      const totalSeats = seatLayout
        ? seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0)
        : (trip.bus?.capacity ?? 0);
      const occupiedSeats  = countByTrip.get(trip.id) ?? 0;
      const availableSeats = Math.max(0, totalSeats - occupiedSeats);

      // Timeline complète des arrêts avec ordre + heure estimée
      const stops = stopsSeq.map((s, idx) => ({
        stationId:     s.stationId,
        name:          s.name,
        city:          s.city || s.name,
        km:            s.distanceFromOriginKm,
        order:         idx,
        estimatedAt:   this.estimateStopTime(trip, s).toISOString(),
        isBoarding:    idx === boardingIdx,
        isAlighting:   idx === alightingIdx,
      }));

      results.push({
        id:               trip.id,
        departure:        boarding.city || boarding.name,
        arrival:          alighting.city || alighting.name,
        departureTime:    boardingEst.toISOString(),
        arrivalTime:      alightingEst.toISOString(),
        price:            priced.price,
        distanceKm:       Math.max(0, alighting.distanceFromOriginKm - boarding.distanceFromOriginKm),
        availableSeats,
        busType:          trip.bus?.type ?? 'STANDARD',
        busModel:         trip.bus?.model ?? '',
        amenities:        trip.bus?.amenities ?? [],
        canBook:          availableSeats >= pax,
        stops,
        boardingStationId:  boarding.stationId,
        alightingStationId: alighting.stationId,
        isIntermediateSegment: !isFullOD,
        isAutoCalculated:      priced.isAutoCalculated,
        seatingMode:      (trip as any).seatingMode ?? 'FREE',
        seatLayout:       seatLayout ?? null,
        seatSelectionFee,
        isFullVip:        (trip.bus as any)?.isFullVip ?? false,
        vipSeats:         (trip.bus as any)?.vipSeats ?? [],
      });

      if (results.length >= 20) break;
    }

    return results;
  }

  /** Construit la séquence ordonnée des arrêts (origine → waypoints → destination). */
  private buildTripStopsSequence(trip: {
    route: {
      originId:      string;
      destinationId: string;
      distanceKm:    number;
      origin:        { id: string; name: string; city: string | null };
      destination:   { id: string; name: string; city: string | null };
      waypoints:     Array<{ order: number; distanceFromOriginKm: number;
                             station: { id: string; name: string; city: string | null } }>;
    };
  }) {
    const seq = [
      {
        stationId:            trip.route.origin.id,
        name:                 trip.route.origin.name,
        city:                 trip.route.origin.city,
        distanceFromOriginKm: 0,
      },
      ...trip.route.waypoints
        .slice()
        .sort((a, b) => a.order - b.order)
        .map(wp => ({
          stationId:            wp.station.id,
          name:                 wp.station.name,
          city:                 wp.station.city,
          distanceFromOriginKm: wp.distanceFromOriginKm,
        })),
      {
        stationId:            trip.route.destination.id,
        name:                 trip.route.destination.name,
        city:                 trip.route.destination.city,
        distanceFromOriginKm: trip.route.distanceKm,
      },
    ];
    return seq;
  }

  /** Test de correspondance textuelle (name OU city, insensible à la casse). */
  private stopMatches(
    stop: { name: string; city: string | null },
    term: string,
  ): boolean {
    if (!term) return false;
    const n = stop.name.toLowerCase();
    const c = (stop.city ?? '').toLowerCase();
    return n.includes(term) || (c !== '' && c.includes(term));
  }

  /** Heure estimée de passage à un arrêt (interpolation linéaire distance/durée). */
  private estimateStopTime(
    trip: { route: { distanceKm: number }; departureScheduled: Date; arrivalScheduled: Date },
    stop: { distanceFromOriginKm: number },
  ): Date {
    const dep = trip.departureScheduled.getTime();
    const arr = trip.arrivalScheduled.getTime();
    const totalKm = trip.route.distanceKm;
    if (totalKm <= 0) return new Date(dep);
    const ratio = Math.min(1, Math.max(0, stop.distanceFromOriginKm / totalKm));
    return new Date(dep + (arr - dep) * ratio);
  }

  // ─── Trip seats (public — real-time availability for seatmap) ─────────────

  async getTripSeats(tenantSlug: string, tripId: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, tenantId: tenant.id, status: { in: ['PLANNED', 'OPEN', 'BOARDING'] } },
      include: { bus: { select: { capacity: true, seatLayout: true, isFullVip: true, vipSeats: true } } },
    });
    if (!trip) throw new NotFoundException('Trip not found');

    const seatLayout = trip.bus?.seatLayout as { rows: number; cols: number; aisleAfter?: number; disabled?: string[] } | null;

    const activeTickets = await this.prisma.ticket.findMany({
      where: { tenantId: tenant.id, tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      select: { seatNumber: true },
    });

    const occupiedSeats = activeTickets
      .map(t => t.seatNumber)
      .filter((s): s is string => s !== null && s !== '');

    let totalSeats = trip.bus?.capacity ?? 0;
    if (seatLayout) {
      totalSeats = seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0);
    }

    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: tenant.id },
      select: { seatSelectionFee: true },
    });

    return {
      seatingMode:      (trip as any).seatingMode ?? 'FREE',
      seatLayout,
      occupiedSeats,
      availableCount:   Math.max(0, totalSeats - occupiedSeats.length),
      totalCount:       totalSeats,
      seatSelectionFee: (bizConfig as any)?.seatSelectionFee ?? 0,
      isFullVip:        (trip.bus as any)?.isFullVip ?? false,
      vipSeats:         (trip.bus as any)?.vipSeats ?? [],
    };
  }

  // ─── Fleet (public) ───────────────────────────────────────────────────────

  async getFleet(tenantSlug: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const buses = await this.prisma.bus.findMany({
      where: { tenantId: tenant.id, status: { not: 'CLOSED' } },
      select: {
        model: true, type: true, capacity: true,
        photos: true, seatLayout: true, year: true, amenities: true,
      },
      orderBy: { type: 'asc' },
    });

    // Generate presigned URLs for photos and return safe public data
    return Promise.all(buses.map(async bus => {
      const photoUrls = await Promise.all(
        (bus.photos ?? []).slice(0, 5).map(async key => {
          try {
            const signed = await this.storage.getDownloadUrl(tenant.id, key, DocumentType.BUS_PHOTO);
            return signed.url;
          } catch { return null; }
        }),
      );

      return {
      model:      bus.model,
      type:       bus.type,
      capacity:   bus.capacity,
      year:       bus.year,
      photos:     photoUrls.filter(Boolean) as string[],
      seatLayout: bus.seatLayout,
      amenities:  bus.amenities ?? [],
      };
    }));
  }

  // ─── Pages CMS (public) ──────────────────────────────────────────────────

  async getPages(tenantSlug: string, locale?: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    return this.prisma.tenantPage.findMany({
      where: {
        tenantId:  tenant.id,
        published: true,
        ...(locale ? { locale } : {}),
      },
      select: { slug: true, title: true, content: true, locale: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getPage(tenantSlug: string, pageSlug: string, locale?: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const page = await this.prisma.tenantPage.findFirst({
      where: {
        tenantId:  tenant.id,
        slug:      pageSlug,
        published: true,
        ...(locale ? { locale } : {}),
      },
      select: { slug: true, title: true, content: true, locale: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  // ─── News (public) ───────────────────────────────────────────────────────

  async getPosts(tenantSlug: string, locale?: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const posts = await this.prisma.tenantPost.findMany({
      where: {
        tenantId:  tenant.id,
        published: true,
        ...(locale ? { locale } : {}),
      },
      select: {
        id: true, title: true, slug: true, excerpt: true, coverImage: true,
        publishedAt: true, authorName: true, locale: true, tags: true,
        media: { select: { url: true, type: true, caption: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    return Promise.all(posts.map(async (post) => {
      let coverImageUrl: string | null = null;
      if (post.coverImage) {
        try {
          const signed = await this.storage.getDownloadUrl(tenant.id, post.coverImage, DocumentType.CMS_MEDIA);
          coverImageUrl = signed.url;
        } catch { /* ignore */ }
      }
      return { ...post, coverImageUrl };
    }));
  }

  async getPostBySlug(tenantSlug: string, postSlug: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const post = await this.prisma.tenantPost.findFirst({
      where: { tenantId: tenant.id, slug: postSlug, published: true },
      select: {
        id: true, title: true, slug: true, excerpt: true, content: true,
        coverImage: true, publishedAt: true, authorName: true, locale: true, tags: true,
        media: { select: { id: true, url: true, type: true, caption: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');

    const mediaWithUrls = await Promise.all(
      post.media.map(async (m) => {
        try {
          const signed = await this.storage.getDownloadUrl(tenant.id, m.url, DocumentType.CMS_MEDIA);
          return { ...m, signedUrl: signed.url };
        } catch {
          return { ...m, signedUrl: null };
        }
      }),
    );

    let coverImageUrl: string | null = null;
    if (post.coverImage) {
      try {
        const signed = await this.storage.getDownloadUrl(tenant.id, post.coverImage, DocumentType.CMS_MEDIA);
        coverImageUrl = signed.url;
      } catch { /* ignore */ }
    }

    return { ...post, media: mediaWithUrls, coverImageUrl };
  }

  async getFooterPages(tenantSlug: string, locale?: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    return this.prisma.tenantPage.findMany({
      where: {
        tenantId:     tenant.id,
        published:    true,
        showInFooter: true,
        ...(locale ? { locale } : {}),
      },
      select: { slug: true, title: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Stations list (for search dropdowns) ─────────────────────────────────

  async getStations(tenantSlug: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const stations = await this.prisma.station.findMany({
      where: { tenantId: tenant.id },
      select: { id: true, name: true, city: true, type: true, coordinates: true },
      orderBy: { city: 'asc' },
    });

    return stations;
  }

  // ─── Booking (real ticket issuance — multi-passenger) ───────────────────────

  async createBooking(tenantSlug: string, dto: {
    tripId: string;
    passengers: Array<{
      firstName: string; lastName: string;
      phone: string; email?: string; seatType: string;
      wantsSeatSelection?: boolean; seatNumber?: string;
    }>;
    paymentMethod: string;
    /** Gare de montée (segment intermédiaire). Défaut = route.originId. */
    boardingStationId?: string;
    /** Gare de descente (segment intermédiaire). Défaut = route.destinationId. */
    alightingStationId?: string;
  }) {
    const tenant = await this.resolveTenant(tenantSlug);

    // Verify trip belongs to this tenant and is bookable — charge aussi
    // waypoints + segmentPrices pour la résolution segment intermédiaire.
    const trip = await this.prisma.trip.findFirst({
      where: { id: dto.tripId, tenantId: tenant.id, status: { in: ['PLANNED', 'OPEN', 'BOARDING'] } },
      include: {
        route: {
          include: {
            origin:        { select: { id: true, name: true, city: true } },
            destination:   { select: { id: true, name: true, city: true } },
            waypoints: {
              orderBy: { order: 'asc' },
              include: { station: { select: { id: true, name: true, city: true } } },
            },
            segmentPrices: { select: { fromStationId: true, toStationId: true, basePriceXaf: true } },
          },
        },
        bus: { select: { capacity: true, seatLayout: true, isFullVip: true, vipSeats: true } },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found or no longer available');

    const busVipSeats = new Set((trip.bus as any)?.vipSeats ?? []);
    const busIsFullVip = (trip.bus as any)?.isFullVip ?? false;

    // Resolve default agency for the tenant (every tenant has at least one)
    const defaultAgency = await this.prisma.agency.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    const agencyId = defaultAgency?.id ?? '';

    // SeatLayout-aware capacity
    const seatLayout = trip.bus?.seatLayout as { rows: number; cols: number; disabled?: string[] } | null;
    const totalSeats = seatLayout
      ? seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0)
      : (trip.bus?.capacity ?? 0);

    // Load seatSelectionFee + politique intermédiaire from business config
    const isNumbered = (trip as any).seatingMode === 'NUMBERED' && !!seatLayout;
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: tenant.id },
      select: {
        seatSelectionFee:              true,
        intermediateBookingEnabled:    true,
        intermediateBookingCutoffMins: true,
        intermediateSegmentBlacklist:  true,
      },
    });
    const seatFee     = bizConfig?.seatSelectionFee ?? 0;
    const interEnabled = bizConfig?.intermediateBookingEnabled ?? true;
    const cutoffMins   = bizConfig?.intermediateBookingCutoffMins ?? 30;
    const blacklist = Array.isArray(bizConfig?.intermediateSegmentBlacklist)
      ? bizConfig!.intermediateSegmentBlacklist as Array<{ routeId: string; fromStationId: string; toStationId: string }>
      : [];

    // ── Résolution boarding / alighting stations ──────────────────────────
    const boardingStationId  = dto.boardingStationId  ?? trip.route.originId;
    const alightingStationId = dto.alightingStationId ?? trip.route.destinationId;

    // Valider que les deux stations sont sur la route
    const routeStationIds = new Set<string>([
      trip.route.originId,
      trip.route.destinationId,
      ...trip.route.waypoints.map(w => w.stationId),
    ]);
    if (!routeStationIds.has(boardingStationId) || !routeStationIds.has(alightingStationId)) {
      throw new BadRequestException('Boarding or alighting station not on this route');
    }

    // Valider l'ordre (boarding doit précéder alighting)
    const routeSnap: RouteSnapshot = {
      basePrice:                 trip.route.basePrice,
      distanceKm:                trip.route.distanceKm,
      allowProportionalFallback: trip.route.allowProportionalFallback,
      originId:                  trip.route.originId,
      destinationId:             trip.route.destinationId,
      waypoints: trip.route.waypoints.map(w => ({
        stationId:            w.stationId,
        distanceFromOriginKm: w.distanceFromOriginKm,
        tollCostXaf:          w.tollCostXaf,
        checkpointCosts:      w.checkpointCosts as unknown,
        order:                w.order,
      })),
    };
    const boardingKm  = stationDistanceOnRoute(boardingStationId, routeSnap);
    const alightingKm = stationDistanceOnRoute(alightingStationId, routeSnap);
    if (boardingKm < 0 || alightingKm < 0) {
      throw new BadRequestException('Invalid boarding/alighting station reference');
    }
    if (alightingKm <= boardingKm) {
      throw new BadRequestException('Alighting station must be after boarding on the route');
    }

    const isFullOD = boardingStationId === trip.route.originId
                  && alightingStationId === trip.route.destinationId;

    // Politique : segments intermédiaires désactivés → seul OD accepté
    if (!interEnabled && !isFullOD) {
      throw new ForbiddenException('Intermediate segment booking is disabled for this tenant');
    }

    // Cut-off (ne s'applique qu'aux segments intermédiaires)
    if (!isFullOD) {
      const msBeforeDeparture = trip.departureScheduled.getTime() - Date.now();
      if (msBeforeDeparture < cutoffMins * 60_000) {
        throw new BadRequestException('Too late to book this intermediate segment');
      }
    }

    // Black-list
    if (blacklist.some(b =>
      b.routeId === trip.route.id &&
      b.fromStationId === boardingStationId &&
      b.toStationId === alightingStationId,
    )) {
      throw new ForbiddenException('This segment is not available for booking');
    }

    // Prix segment (manuel ou proportionnel)
    const priced = resolveSegmentPriceFromSnapshot(
      routeSnap,
      boardingStationId,
      alightingStationId,
      trip.route.segmentPrices,
    );
    if (priced.blocked) {
      throw new BadRequestException(priced.warnings[0] ?? 'Price not configured for this segment');
    }
    const segmentBasePrice = priced.price;

    // 1. Create all tickets in PENDING_PAYMENT (single transaction for atomicity)
    const tickets = await this.prisma.transact(async (tx) => {
      // Filtre "billet actif" : exclut les statuts inactifs ET les PENDING_PAYMENT
      // dont la fenêtre de paiement est expirée (ils ne peuvent plus être confirmés
      // et ne doivent donc pas bloquer les retries après un échec technique).
      const now = new Date();
      const activeTicketWhere = {
        tenantId: tenant.id,
        tripId:   dto.tripId,
        status:   { notIn: ['CANCELLED', 'EXPIRED'] as string[] },
        NOT: { AND: [{ status: 'PENDING_PAYMENT' as const }, { expiresAt: { lte: now } }] },
      };

      // ── Garde capacité globale (pour tous les passagers demandés) ────────
      const bookedCount = await tx.ticket.count({ where: activeTicketWhere });
      if (totalSeats > 0 && bookedCount + dto.passengers.length > totalSeats) {
        throw new BadRequestException(
          `Not enough seats: ${totalSeats - bookedCount} available, ${dto.passengers.length} requested`,
        );
      }

      // ── Charger les sièges occupés une seule fois (NUMBERED) ────────────
      const occupiedSeats = new Set<string>();
      if (isNumbered) {
        const occupiedRows = await tx.ticket.findMany({
          where:  { ...activeTicketWhere, seatNumber: { not: null } },
          select: { seatNumber: true },
        });
        for (const row of occupiedRows as Array<{ seatNumber: string | null }>) if (row.seatNumber) occupiedSeats.add(row.seatNumber);
      }

      // ── Charger les noms déjà bookés pour le contrôle de doublon ────────
      const existingNames = await tx.ticket.findMany({
        where:  activeTicketWhere,
        select: { passengerName: true },
      });
      const bookedNames = new Set((existingNames as Array<{ passengerName: string }>).map(r => r.passengerName.toLowerCase()));

      const created: Array<{ id: string; seatNumber: string | null; fareClass: string; pricePaid: number; wantsSeatSelection: boolean; passengerIdx: number; customerId: string | null }> = [];

      for (let i = 0; i < dto.passengers.length; i++) {
        const pax = dto.passengers[i];
        const passengerName = `${pax.firstName} ${pax.lastName}`.trim();
        // fareClass = VIP si : bus tout VIP, OU siège choisi est VIP, OU passager a choisi seatType VIP
        const seatIsVip = busIsFullVip || (pax.seatNumber ? busVipSeats.has(pax.seatNumber) : false);
        const fareClass = (seatIsVip || pax.seatType === 'VIP') ? 'VIP' : 'STANDARD';

        // ── Garde doublon passager ──────────────────────────────────────
        if (bookedNames.has(passengerName.toLowerCase())) {
          throw new ConflictException(
            `A ticket already exists for "${passengerName}" on this trip`,
          );
        }
        bookedNames.add(passengerName.toLowerCase());

        // ── Attribution du siège (NUMBERED) ─────────────────────────────
        let seatNumber: string | null = null;
        const wantsSeat = !!pax.wantsSeatSelection;

        if (isNumbered && seatLayout) {
          if (wantsSeat && pax.seatNumber) {
            // Validate chosen seat
            const parts = pax.seatNumber.split('-');
            if (parts.length !== 2) throw new BadRequestException(`Invalid seat format: ${pax.seatNumber}`);
            const [r, c] = parts.map(Number);
            if (isNaN(r) || isNaN(c) || r < 1 || r > seatLayout.rows || c < 1 || c > seatLayout.cols) {
              throw new BadRequestException(`Seat ${pax.seatNumber} is out of range`);
            }
            if (seatLayout.disabled?.includes(pax.seatNumber)) {
              throw new BadRequestException(`Seat ${pax.seatNumber} is disabled`);
            }
            if (occupiedSeats.has(pax.seatNumber)) {
              throw new ConflictException(`Seat ${pax.seatNumber} is already taken`);
            }
            seatNumber = pax.seatNumber;
          } else {
            // Auto-assign next free seat
            for (let r = 1; r <= seatLayout.rows; r++) {
              for (let c = 1; c <= seatLayout.cols; c++) {
                const id = `${r}-${c}`;
                if (seatLayout.disabled?.includes(id)) continue;
                if (occupiedSeats.has(id)) continue;
                seatNumber = id;
                break;
              }
              if (seatNumber) break;
            }
            if (!seatNumber) throw new BadRequestException('No seats available for this trip');
          }
          occupiedSeats.add(seatNumber);
        }

        // ── Prix = base segment (OD ou intermédiaire) + supplément siège ─
        const seatSurcharge = (wantsSeat && isNumbered && seatFee > 0) ? seatFee : 0;
        const pricePaid = segmentBasePrice + seatSurcharge;

        // ── Résolution CRM passager (shadow si inconnu) ─────────────────
        const crmRes = await this.crmResolver.resolveOrCreate(
          tenant.id,
          { name: passengerName, phone: pax.phone, email: pax.email },
          tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2],
        );

        const ticketId = uuidv4();
        const t = await tx.ticket.create({
          data: {
            id:                 ticketId,
            tenantId:           tenant.id,
            tripId:             dto.tripId,
            passengerId:        null,
            passengerName,
            passengerPhone:     pax.phone?.trim() || null,
            passengerEmail:     pax.email?.trim() || null,
            customerId:         crmRes?.customer.id ?? null,
            seatNumber,
            boardingStationId,
            alightingStationId,
            fareClass,
            pricePaid,
            agencyId,
            status:             'PENDING_PAYMENT',
            qrCode:             `pending-${ticketId}`,
            expiresAt:          new Date(Date.now() + 15 * 60_000),
            version:            0,
          },
        });

        if (crmRes?.customer.id) {
          await this.crmResolver.bumpCounters(
            tx as any,
            crmRes.customer.id, 'ticket',
            BigInt(Math.round(pricePaid * 100)),
            { source: 'PUBLIC' },
          );
        }

        const event: DomainEvent = {
          id:            uuidv4(),
          type:          EventTypes.TICKET_ISSUED,
          tenantId:      tenant.id,
          aggregateId:   t.id,
          aggregateType: 'Ticket',
          payload:       { ticketId: t.id, tripId: dto.tripId, price: pricePaid, source: 'portal', customerId: crmRes?.customer.id ?? null },
          occurredAt:    new Date(),
        };
        await this.eventBus.publish(event, tx as any);

        created.push({ id: t.id, seatNumber, fareClass, pricePaid, wantsSeatSelection: wantsSeat, passengerIdx: i, customerId: crmRes?.customer.id ?? null });
      }

      return created;
    });

    // 2. Confirm all tickets (payment not yet implemented — simulate success)
    const systemActor = {
      id:       'portal-system',
      tenantId: tenant.id,
      roleId:   'portal-system',
      roleName: 'SYSTEM',
      agencyId,
      userType: 'ANONYMOUS',
    } as any;
    const confirmedTickets = await Promise.all(
      tickets.map(async (tk) => {
        const qrToken = await this.qrService.sign({
          ticketId:   tk.id,
          tenantId:   tenant.id,
          tripId:     dto.tripId,
          seatNumber: tk.seatNumber,
          issuedAt:   Date.now(),
        });

        const confirmed = await this.prisma.ticket.update({
          where: { id: tk.id },
          data:  { status: 'CONFIRMED', qrCode: qrToken, version: { increment: 1 } },
        });

        // Generate documents — fire-and-forget on error
        let ticketDocUrl: string | null = null;
        let invoiceDocUrl: string | null = null;
        let documentsWarning: string | null = null;
        try {
          const [ticketDoc, invoiceDoc] = await Promise.all([
            this.documentsService.printTicketStub(tenant.id, tk.id, systemActor, undefined),
            this.documentsService.printInvoicePro(tenant.id, tk.id, systemActor, undefined),
          ]);
          ticketDocUrl  = (ticketDoc  as any)?.downloadUrl ?? null;
          invoiceDocUrl = (invoiceDoc as any)?.downloadUrl ?? null;
        } catch (err) {
          this.logger.error(`[Portal] Document generation FAILED for ticket ${tk.id}: ${(err as Error)?.stack ?? err}`);
          documentsWarning = `Documents temporairement indisponibles : ${(err as Error)?.message ?? 'erreur interne'}`;
        }

        const pax = dto.passengers[tk.passengerIdx];
        return {
          bookingRef: confirmed.id.slice(0, 12).toUpperCase(),
          ticketId:   confirmed.id,
          status:     'CONFIRMED' as const,
          qrCode:     qrToken,
          fareClass:  tk.fareClass,
          seatNumber: tk.seatNumber,
          pricePaid:  tk.pricePaid,
          wantsSeatSelection: tk.wantsSeatSelection,
          passenger:  { firstName: pax.firstName, lastName: pax.lastName },
          documents:  { ticketStubUrl: ticketDocUrl, invoiceUrl: invoiceDocUrl, warning: documentsWarning },
        };
      }),
    );

    const totalPrice = tickets.reduce((sum, tk) => sum + tk.pricePaid, 0);

    // Émission magic link + recompute segments CRM (fire-and-forget, hors tx).
    // Dédupe par customerId pour n'émettre qu'un lien par client unique.
    const uniqueCustomerIds = Array.from(new Set(
      tickets.map(tk => tk.customerId).filter((x): x is string => !!x),
    ));
    for (const cid of uniqueCustomerIds) {
      void this.crmClaim.issueToken(tenant.id, cid).catch(err =>
        this.logger.warn(`[CRM Claim] issueToken failed: ${err?.message ?? err}`),
      );
      void this.crmResolver.recomputeSegmentsFor(tenant.id, cid);
    }

    // Résoudre les libellés des gares de montée/descente pour la réponse
    const boardingLabel = boardingStationId === trip.route.originId
      ? (trip.route.origin.city || trip.route.origin.name)
      : (trip.route.waypoints.find(w => w.stationId === boardingStationId)?.station.city
         || trip.route.waypoints.find(w => w.stationId === boardingStationId)?.station.name
         || '');
    const alightingLabel = alightingStationId === trip.route.destinationId
      ? (trip.route.destination.city || trip.route.destination.name)
      : (trip.route.waypoints.find(w => w.stationId === alightingStationId)?.station.city
         || trip.route.waypoints.find(w => w.stationId === alightingStationId)?.station.name
         || '');

    return {
      tickets: confirmedTickets,
      trip: {
        departure:     boardingLabel,
        arrival:       alightingLabel,
        departureTime: trip.departureScheduled.toISOString(),
        arrivalTime:   trip.arrivalScheduled.toISOString(),
        routeName:     trip.route.name,
        price:         segmentBasePrice,
        boardingStationId,
        alightingStationId,
        isIntermediateSegment: !isFullOD,
      },
      totalPrice,
      seatSelectionFee: seatFee,
      paymentMethod: dto.paymentMethod,
    };
  }

  // ── Self-service annulation / remboursement ─────────────────────────────

  /**
   * Aperçu du montant remboursable — aucune mutation.
   * Vérification identité par nom complet du passager (passengerName sur le Ticket).
   */
  async previewRefund(tenantSlug: string, ticketRef: string, phone: string) {
    if (!phone) throw new BadRequestException('Passenger name required for identity verification');

    const tenant = await this.resolveTenant(tenantSlug);
    const ticket = await this.resolveTicketByRef(tenant.id, ticketRef, phone);

    const calc = await this.policyService.calculateRefundAmount(tenant.id, ticket.id);

    return {
      ticketRef,
      originalAmount: calc.originalAmount,
      refundPercent:  calc.refundPercent,
      refundAmount:   calc.refundAmount,
      currency:       calc.currency,
      departureAt:    calc.departureAt.toISOString(),
      refundable:     calc.refundPercent > 0,
    };
  }

  /**
   * Demande d'annulation self-service par le voyageur.
   * Vérifie l'identité par nom du passager, crée le remboursement
   * basé sur la politique d'annulation du tenant.
   */
  async requestCancellation(
    tenantSlug: string,
    ticketRef:  string,
    dto: { phone: string; reason?: string },
  ) {
    if (!dto.phone) throw new BadRequestException('Passenger name required for identity verification');

    const tenant = await this.resolveTenant(tenantSlug);
    const ticket = await this.resolveTicketByRef(tenant.id, ticketRef, dto.phone);

    if (ticket.status !== 'CONFIRMED') {
      throw new BadRequestException(
        `Ticket cannot be cancelled (current status: ${ticket.status})`,
      );
    }

    // Créer le remboursement via la politique tarifaire
    const refund = await this.refundService.createPolicyBasedRefund({
      tenantId:       tenant.id,
      ticketId:       ticket.id,
      reason:         RefundReason.CUSTOMER_SELF_SERVICE,
      requestedBy:    'CUSTOMER',
      requestChannel: 'PORTAL',
    });

    return {
      ticketRef,
      status:        'CANCELLATION_REQUESTED',
      refundId:      (refund as any).id,
      refundAmount:  (refund as any).amount,
      refundPercent: (refund as any).policyPercent,
      currency:      (refund as any).currency,
    };
  }

  // ── Colis — demande d'enlèvement publique (anonyme) ─────────────────────

  /**
   * Demande d'enlèvement de colis soumise depuis le portail voyageur.
   * Anonyme — l'agent vérifie l'identité de l'expéditeur lors du dépôt en agence.
   * Résout la station destination par nom/ville (insensible à la casse).
   */
  async createParcelPickupRequest(tenantSlug: string, dto: {
    senderName: string; senderPhone: string;
    recipientName: string; recipientPhone: string;
    fromCity: string; toCity: string;
    description: string; weightKg?: number;
  }) {
    const tenant = await this.resolveTenant(tenantSlug);

    const destination = await this.prisma.station.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          { city: { equals: dto.toCity, mode: 'insensitive' } },
          { city: { contains: dto.toCity, mode: 'insensitive' } },
          { name: { contains: dto.toCity, mode: 'insensitive' } },
        ],
      },
      orderBy: { type: 'asc' },
      select: { id: true, name: true, city: true },
    });
    if (!destination) {
      throw new NotFoundException(`No station found for destination "${dto.toCity}"`);
    }

    const trackingCode = this.generateParcelTrackingCode(tenant.id);
    const parcelId = uuidv4();

    const parcel = await this.prisma.transact(async (tx) => {
      // ── Résolution CRM expéditeur + destinataire (shadow si inconnus) ──
      const senderRes = await this.crmResolver.resolveOrCreate(
        tenant.id,
        { name: dto.senderName, phone: dto.senderPhone },
        tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2],
      );
      const recipientRes = await this.crmResolver.resolveOrCreate(
        tenant.id,
        { name: dto.recipientName, phone: dto.recipientPhone },
        tx as unknown as Parameters<typeof this.crmResolver.resolveOrCreate>[2],
      );

      const created = await tx.parcel.create({
        data: {
          id:                  parcelId,
          tenantId:            tenant.id,
          trackingCode,
          senderId:            null,
          senderCustomerId:    senderRes?.customer.id ?? null,
          recipientCustomerId: recipientRes?.customer.id ?? null,
          weight:              dto.weightKg ?? 0,
          price:               0,
          destinationId:       destination.id,
          recipientInfo: {
            name:        dto.recipientName,
            phone:       dto.recipientPhone,
            sender:      { name: dto.senderName, phone: dto.senderPhone },
            fromCity:    dto.fromCity,
            toCity:      dto.toCity,
            description: dto.description,
            source:      'portal',
          },
          status:  ParcelState.CREATED,
          version: 0,
        },
      });

      if (senderRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as any,
          senderRes.customer.id, 'parcel',
          0n,
          { source: 'PUBLIC' },
        );
      }
      if (recipientRes?.customer.id && recipientRes.customer.id !== senderRes?.customer.id) {
        await this.crmResolver.bumpCounters(
          tx as any,
          recipientRes.customer.id, 'parcel',
          0n,
          { source: 'PUBLIC' },
        );
      }

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.PARCEL_REGISTERED,
        tenantId:      tenant.id,
        aggregateId:   created.id,
        aggregateType: 'Parcel',
        payload:       {
          parcelId: created.id,
          trackingCode,
          source: 'portal',
          senderCustomerId:    senderRes?.customer.id ?? null,
          recipientCustomerId: recipientRes?.customer.id ?? null,
        },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as any);

      return created;
    });

    // Émission magic link + recompute segments CRM (fire-and-forget, hors tx).
    const postTx = (cid: string | null | undefined) => {
      if (!cid) return;
      void this.crmClaim.issueToken(tenant.id, cid).catch(err =>
        this.logger.warn(`[CRM Claim] issueToken failed: ${err?.message ?? err}`),
      );
      void this.crmResolver.recomputeSegmentsFor(tenant.id, cid);
    };
    postTx(parcel.senderCustomerId);
    if (parcel.recipientCustomerId !== parcel.senderCustomerId) {
      postTx(parcel.recipientCustomerId);
    }

    this.logger.log(
      `[Portal] Parcel pickup request created: ${parcel.id} tracking=${trackingCode} tenant=${tenant.slug}`,
    );

    // Notification tracking — WhatsApp préféré, SMS en repli (fire-and-forget).
    // On notifie l'expéditeur (qui vient de soumettre) et le destinataire.
    const lang = (tenant.language as string | undefined) ?? 'fr';
    const notify = (phone: string, name: string, role: 'sender' | 'recipient') => {
      void this.notification.sendWithChannelFallback({
        tenantId:   tenant.id,
        phone,
        templateId: 'parcel.tracking',
        body:       this.renderParcelTrackingBody(lang, name, trackingCode, role),
        metadata:   { trackingCode, role, source: 'portal' },
      }).catch(err => this.logger.warn(
        `[Portal Notif] ${role} tracking=${trackingCode}: ${(err as Error)?.message ?? err}`,
      ));
    };
    if (dto.senderPhone)    notify(dto.senderPhone,    dto.senderName    || '', 'sender');
    if (dto.recipientPhone) notify(dto.recipientPhone, dto.recipientName || '', 'recipient');

    // Génération récépissé/label colis — fire-and-forget sur erreur.
    // Le client peut télécharger le bordereau imprimable depuis la page de
    // confirmation portail.
    const systemActor = {
      id:       'portal-system',
      tenantId: tenant.id,
      roleId:   'portal-system',
      roleName: 'SYSTEM',
      agencyId: '',
      userType: 'ANONYMOUS',
    } as any;
    let labelUrl: string | null = null;
    let documentsWarning: string | null = null;
    try {
      const label = await this.documentsService.printParcelLabel(
        tenant.id, parcel.id, systemActor, undefined,
      );
      labelUrl = (label as any)?.downloadUrl ?? null;
    } catch (err) {
      this.logger.error(
        `[Portal] Parcel label generation FAILED for ${parcel.id}: ${(err as Error)?.stack ?? err}`,
      );
      documentsWarning = `Document temporairement indisponible : ${(err as Error)?.message ?? 'erreur interne'}`;
    }

    return {
      trackingCode: parcel.trackingCode,
      status:       parcel.status,
      destination:  { name: destination.name, city: destination.city },
      labelUrl,
      documentsWarning,
    };
  }

  private renderParcelTrackingBody(
    lang:         string,
    name:         string,
    trackingCode: string,
    role:         'sender' | 'recipient',
  ): string {
    const greeting = name ? (lang === 'en' ? `Hello ${name}, ` : `Bonjour ${name}, `) : '';
    if (lang === 'en') {
      return role === 'recipient'
        ? `${greeting}a parcel is on its way for you. Tracking code: ${trackingCode}`
        : `${greeting}your parcel pickup request has been registered. Tracking code: ${trackingCode}`;
    }
    return role === 'recipient'
      ? `${greeting}un colis vous est destiné. Code de suivi : ${trackingCode}`
      : `${greeting}votre demande d'enlèvement a été enregistrée. Code de suivi : ${trackingCode}`;
  }

  /**
   * Suivi public d'un colis par code — ne retourne que les champs non sensibles.
   * Pas d'ID interne, pas d'infos expéditeur/destinataire.
   */
  async trackParcelByCode(tenantSlug: string, trackingCode: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const parcel = await this.prisma.parcel.findFirst({
      where:   { tenantId: tenant.id, trackingCode },
      include: { destination: { select: { name: true, city: true } } },
    });
    if (!parcel) throw new NotFoundException('Parcel not found');

    const info = (parcel.recipientInfo ?? {}) as Record<string, unknown>;

    return {
      trackingCode: parcel.trackingCode,
      status:       parcel.status,
      fromCity:     (info.fromCity as string | undefined) ?? null,
      toCity:       parcel.destination?.city || parcel.destination?.name || null,
      createdAt:    parcel.createdAt.toISOString(),
    };
  }

  private generateParcelTrackingCode(tenantId: string): string {
    const prefix = tenantId.slice(0, 4).toUpperCase();
    const ts     = Date.now().toString(36).toUpperCase();
    const rand   = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${prefix}-${ts}-${rand}`;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Résout un billet par QR code ou booking ref + vérification par nom du passager.
   * Utilisé pour les endpoints self-service (pas d'auth, identité par passengerName).
   */
  private async resolveTicketByRef(tenantId: string, ticketRef: string, passengerName: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        tenantId,
        OR: [
          { qrCode: ticketRef },
          { id: ticketRef },
        ],
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    // Vérifier que le nom correspond au passager du billet
    if (ticket.passengerName.toLowerCase() !== passengerName.toLowerCase()) {
      throw new ForbiddenException('Passenger name does not match ticket holder');
    }

    return ticket;
  }
}
