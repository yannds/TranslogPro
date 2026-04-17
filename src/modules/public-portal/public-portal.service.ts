/**
 * PublicPortalService — Logique métier pour le portail public voyageur.
 *
 * Toutes les requêtes sont scoped par tenantSlug (résolu en tenantId).
 * Aucune donnée sensible n'est exposée (pas d'IDs internes, pas de
 * données financières, pas de données personnelles d'autres utilisateurs).
 */
import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService }   from '../../infrastructure/database/prisma.service';
import { WhiteLabelService } from '../white-label/white-label.service';
import { QrService }        from '../../core/security/qr/qr.service';
import { DocumentsService } from '../documents/documents.service';
import { REDIS_CLIENT }     from '../../infrastructure/eventbus/redis-publisher.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ─── Tenant resolution ────────────────────────────────────────────────────

  /** Resolve tenant slug to tenant ID. Cached in Redis (5 min). */
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
        themeId:      portalConfig.themeId,
        showAbout:    portalConfig.showAbout,
        showFleet:    portalConfig.showFleet,
        showNews:     portalConfig.showNews,
        showContact:  portalConfig.showContact,
        heroImageUrl: portalConfig.heroImageUrl,
        heroOverlay:  portalConfig.heroOverlay,
        slogans:      portalConfig.slogans,
        socialLinks:  portalConfig.socialLinks,
        ogImageUrl:   portalConfig.ogImageUrl,
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
            seatLayout: true, photos: true,
          },
        },
      },
      orderBy: { departureScheduled: 'asc' },
      take: 20,
    });

    // Map to safe public DTOs (no internal IDs exposed beyond trip ID)
    return trips.map(trip => {
      const occupiedSeats = 0; // TODO: count from tickets
      const availableSeats = (trip.bus?.capacity ?? 0) - occupiedSeats;

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
        amenities:     [], // TODO: derive from bus type
        canBook:       availableSeats >= pax,
        stops,
      };
    });
  }

  // ─── Fleet (public) ───────────────────────────────────────────────────────

  async getFleet(tenantSlug: string) {
    const tenant = await this.resolveTenant(tenantSlug);

    const buses = await this.prisma.bus.findMany({
      where: { tenantId: tenant.id, status: { not: 'CLOSED' } },
      select: {
        model: true, type: true, capacity: true,
        photos: true, seatLayout: true, year: true,
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

    return this.prisma.tenantPost.findMany({
      where: {
        tenantId:  tenant.id,
        published: true,
        ...(locale ? { locale } : {}),
      },
      select: {
        id: true, title: true, excerpt: true, coverImage: true,
        publishedAt: true, authorName: true, locale: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 20,
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

  // ─── Booking (real ticket issuance) ────────────────────────────────────────

  async createBooking(tenantSlug: string, dto: {
    tripId: string;
    passenger: {
      firstName: string; lastName: string;
      phone: string; email?: string; seatType: string;
    };
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
        bus: { select: { capacity: true } },
      },
    });
    if (!trip) throw new NotFoundException('Trip not found or no longer available');

    // Check seat availability
    const bookedCount = await this.prisma.ticket.count({
      where: { tenantId: tenant.id, tripId: dto.tripId, status: { notIn: ['CANCELLED', 'EXPIRED'] } },
    });
    const capacity = trip.bus?.capacity ?? 0;
    if (capacity > 0 && bookedCount >= capacity) {
      throw new BadRequestException('No seats available for this trip');
    }

    // Resolve default agency for the tenant (every tenant has at least one)
    const defaultAgency = await this.prisma.agency.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    const agencyId = defaultAgency?.id ?? '';

    const passengerName = `${dto.passenger.firstName} ${dto.passenger.lastName}`.trim();
    const fareClass = dto.passenger.seatType === 'VIP' ? 'VIP' : 'STANDARD';

    // 1. Create ticket in PENDING_PAYMENT
    const ticketId = uuidv4();
    const pendingQr = `pending-${ticketId}`;

    const ticket = await this.prisma.transact(async (tx) => {
      const t = await tx.ticket.create({
        data: {
          id:                 ticketId,
          tenantId:           tenant.id,
          tripId:             dto.tripId,
          passengerId:        'portal-anonymous',
          passengerName,
          boardingStationId:  trip.route.origin.id,
          alightingStationId: trip.route.destination.id,
          fareClass,
          pricePaid:          trip.route.basePrice,
          agencyId,
          status:             'PENDING_PAYMENT',
          qrCode:             pendingQr,
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
        payload:       { ticketId: t.id, tripId: dto.tripId, price: trip.route.basePrice, source: 'portal' },
        occurredAt:    new Date(),
      };
      await this.eventBus.publish(event, tx as unknown as Parameters<typeof this.eventBus.publish>[1]);

      return t;
    });

    // 2. Immediately confirm (payment not yet implemented — simulate success)
    const qrToken = await this.qrService.sign({
      ticketId:   ticket.id,
      tenantId:   tenant.id,
      tripId:     dto.tripId,
      seatNumber: 'UNASSIGNED',
      issuedAt:   Date.now(),
    });

    const confirmedTicket = await this.prisma.ticket.update({
      where: { id: ticket.id },
      data:  { status: 'CONFIRMED', qrCode: qrToken, version: { increment: 1 } },
    });

    // 3. Generate documents (ticket stub + invoice) — fire-and-forget on error
    const systemActor = { id: 'portal-system', tenantId: tenant.id, agencyId, role: 'SYSTEM' } as any;
    let ticketDocUrl: string | null = null;
    let invoiceDocUrl: string | null = null;

    try {
      const [ticketDoc, invoiceDoc] = await Promise.all([
        this.documentsService.printTicketStub(tenant.id, ticket.id, systemActor, undefined),
        this.documentsService.printInvoicePro(tenant.id, ticket.id, systemActor, undefined),
      ]);
      ticketDocUrl  = (ticketDoc  as any)?.downloadUrl ?? null;
      invoiceDocUrl = (invoiceDoc as any)?.downloadUrl ?? null;
    } catch (err) {
      this.logger.warn(`Document generation failed for portal ticket ${ticket.id}: ${err}`);
    }

    return {
      bookingRef:     confirmedTicket.id.slice(0, 12).toUpperCase(),
      ticketId:       confirmedTicket.id,
      status:         'CONFIRMED',
      qrCode:         qrToken,
      trip: {
        departure:     trip.route.origin.city || trip.route.origin.name,
        arrival:       trip.route.destination.city || trip.route.destination.name,
        departureTime: trip.departureScheduled.toISOString(),
        arrivalTime:   trip.arrivalScheduled.toISOString(),
        routeName:     trip.route.name,
        price:         trip.route.basePrice,
      },
      passenger: {
        firstName: dto.passenger.firstName,
        lastName:  dto.passenger.lastName,
      },
      fareClass,
      paymentMethod: dto.paymentMethod,
      documents: {
        ticketStubUrl: ticketDocUrl,
        invoiceUrl:    invoiceDocUrl,
      },
    };
  }
}
