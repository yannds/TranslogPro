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
import { v4 as uuidv4 } from 'uuid';

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
  ) {}

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

    // Find trips for this tenant on the given date with available seats
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId: tenant.id,
        status:   { in: ['PLANNED', 'OPEN', 'BOARDING'] },
        departureScheduled: { gte: dayStart, lt: dayEnd },
        route: {
          origin:      { OR: [{ name: { contains: params.departure, mode: 'insensitive' } }, { city: { contains: params.departure, mode: 'insensitive' } }] },
          destination: { OR: [{ name: { contains: params.arrival, mode: 'insensitive' } }, { city: { contains: params.arrival, mode: 'insensitive' } }] },
        },
      },
      include: {
        route: {
          include: {
            origin:      { select: { name: true, city: true } },
            destination: { select: { name: true, city: true } },
            waypoints:   {
              orderBy: { order: 'asc' },
              include: { station: { select: { name: true, city: true } } },
            },
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
      take: 20,
    });

    // Load seatSelectionFee from business config
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: tenant.id },
      select: { seatSelectionFee: true },
    });
    const seatSelectionFee = bizConfig?.seatSelectionFee ?? 0;

    // Count occupied seats per trip
    const tripIds = trips.map(t => t.id);
    const ticketCounts = await this.prisma.ticket.groupBy({
      by: ['tripId'],
      where: { tenantId: tenant.id, tripId: { in: tripIds }, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
      _count: true,
    });
    const countByTrip = new Map(ticketCounts.map(c => [c.tripId, c._count]));

    // Map to safe public DTOs (no internal IDs exposed beyond trip ID)
    return trips.map(trip => {
      const seatLayout = trip.bus?.seatLayout as { rows: number; cols: number; aisleAfter?: number; disabled?: string[] } | null;
      const totalSeats = seatLayout
        ? seatLayout.rows * seatLayout.cols - (seatLayout.disabled?.length ?? 0)
        : (trip.bus?.capacity ?? 0);
      const occupiedSeats = countByTrip.get(trip.id) ?? 0;
      const availableSeats = totalSeats - occupiedSeats;

      // Build stops list from waypoints
      const stops = trip.route.waypoints.map(wp => ({
        city: wp.station.city || wp.station.name,
        name: wp.station.name,
        km:   wp.distanceFromOriginKm,
      }));

      return {
        id:            trip.id,
        departure:     trip.route.origin.city || trip.route.origin.name,
        arrival:       trip.route.destination.city || trip.route.destination.name,
        departureTime: trip.departureScheduled.toISOString(),
        arrivalTime:   trip.arrivalScheduled.toISOString(),
        price:         trip.route.basePrice,
        distanceKm:    trip.route.distanceKm,
        availableSeats: Math.max(0, availableSeats),
        busType:       trip.bus?.type ?? 'STANDARD',
        busModel:      trip.bus?.model ?? '',
        amenities:     trip.bus?.amenities ?? [],
        canBook:       availableSeats >= pax,
        stops,
        seatingMode:      (trip as any).seatingMode ?? 'FREE',
        seatLayout:       seatLayout ?? null,
        seatSelectionFee,
        isFullVip:        (trip.bus as any)?.isFullVip ?? false,
        vipSeats:         (trip.bus as any)?.vipSeats ?? [],
      };
    });
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
      select: { name: true, city: true, type: true, coordinates: true },
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
  }) {
    const tenant = await this.resolveTenant(tenantSlug);

    // Verify trip belongs to this tenant and is bookable
    const trip = await this.prisma.trip.findFirst({
      where: { id: dto.tripId, tenantId: tenant.id, status: { in: ['PLANNED', 'OPEN', 'BOARDING'] } },
      include: {
        route: {
          include: {
            origin:      { select: { id: true, name: true, city: true } },
            destination: { select: { id: true, name: true, city: true } },
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

    // Load seatSelectionFee from business config
    const isNumbered = (trip as any).seatingMode === 'NUMBERED' && !!seatLayout;
    const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId: tenant.id },
      select: { seatSelectionFee: true },
    });
    const seatFee = (bizConfig as any)?.seatSelectionFee ?? 0;

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

      const created: Array<{ id: string; seatNumber: string | null; fareClass: string; pricePaid: number; wantsSeatSelection: boolean; passengerIdx: number }> = [];

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

        // ── Prix = base + supplément choix de siège si applicable ───────
        const seatSurcharge = (wantsSeat && isNumbered && seatFee > 0) ? seatFee : 0;
        const pricePaid = trip.route.basePrice + seatSurcharge;

        const ticketId = uuidv4();
        const t = await tx.ticket.create({
          data: {
            id:                 ticketId,
            tenantId:           tenant.id,
            tripId:             dto.tripId,
            passengerId:        'portal-anonymous',
            passengerName,
            seatNumber,
            boardingStationId:  trip.route.origin.id,
            alightingStationId: trip.route.destination.id,
            fareClass,
            pricePaid,
            agencyId,
            status:             'PENDING_PAYMENT',
            qrCode:             `pending-${ticketId}`,
            expiresAt:          new Date(Date.now() + 15 * 60_000),
            version:            0,
          },
        });

        const event: DomainEvent = {
          id:            uuidv4(),
          type:          EventTypes.TICKET_ISSUED,
          tenantId:      tenant.id,
          aggregateId:   t.id,
          aggregateType: 'Ticket',
          payload:       { ticketId: t.id, tripId: dto.tripId, price: pricePaid, source: 'portal' },
          occurredAt:    new Date(),
        };
        await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

        created.push({ id: t.id, seatNumber, fareClass, pricePaid, wantsSeatSelection: wantsSeat, passengerIdx: i });
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

    return {
      tickets: confirmedTickets,
      trip: {
        departure:     trip.route.origin.city || trip.route.origin.name,
        arrival:       trip.route.destination.city || trip.route.destination.name,
        departureTime: trip.departureScheduled.toISOString(),
        arrivalTime:   trip.arrivalScheduled.toISOString(),
        routeName:     trip.route.name,
        price:         trip.route.basePrice,
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
      const created = await tx.parcel.create({
        data: {
          id:            parcelId,
          tenantId:      tenant.id,
          trackingCode,
          senderId:      'portal-anonymous',
          weight:        dto.weightKg ?? 0,
          price:         0,
          destinationId: destination.id,
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

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          EventTypes.PARCEL_REGISTERED,
        tenantId:      tenant.id,
        aggregateId:   created.id,
        aggregateType: 'Parcel',
        payload:       { parcelId: created.id, trackingCode, source: 'portal' },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return created;
    });

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
