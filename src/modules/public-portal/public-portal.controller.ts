/**
 * PublicPortalController — Endpoints publics du portail voyageur.
 *
 * Toutes les routes sont sans auth (pas de @RequirePermission).
 * Protection : rate limiting Redis par IP (RedisRateLimitGuard).
 * Path : /public/:tenantSlug/portal/*
 *
 * Sécurité :
 *   - Aucune donnée sensible exposée (pas d'IDs internes sauf tripId pour booking)
 *   - Rate limiting agressif sur le booking (10/h/IP)
 *   - Search limité à 30 req/min/IP
 *   - tenantSlug validé en DB (pas de slug injection)
 */
import {
  Controller, Get, Post, Param, Query, Body, UseGuards,
} from '@nestjs/common';
import { PublicPortalService }   from './public-portal.service';
import { SearchTripsDto }        from './dto/search-trips.dto';
import { CreateBookingDto }      from './dto/create-booking.dto';
import { CreateParcelPickupRequestDto } from './dto/create-parcel-pickup-request.dto';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

@Controller('public/:tenantSlug/portal')
export class PublicPortalController {
  constructor(private readonly service: PublicPortalService) {}

  /** Config complète du portail (brand + portal + payment methods) */
  @Get('config')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_config',
    message: 'Too many requests. Please try again later.',
  })
  getConfig(@Param('tenantSlug') slug: string) {
    return this.service.getPortalConfig(slug);
  }

  /** Liste des gares/villes pour les dropdowns de recherche */
  @Get('stations')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_stations',
    message: 'Too many requests.',
  })
  getStations(@Param('tenantSlug') slug: string) {
    return this.service.getStations(slug);
  }

  /** Dates avec trajets disponibles (pour le calendrier voyageur) */
  @Get('trips/dates')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 30, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_trip_dates',
    message: 'Too many requests. Please wait a moment.',
  })
  getTripDates(
    @Param('tenantSlug') slug: string,
    @Query('month') month?: string,
  ) {
    return this.service.getTripDates(slug, month);
  }

  /** Recherche de trajets */
  @Get('trips/search')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 30, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_search',
    message: 'Too many search requests. Please wait a moment.',
  })
  searchTrips(
    @Param('tenantSlug') slug: string,
    @Query() dto: SearchTripsDto,
  ) {
    return this.service.searchTrips(slug, dto);
  }

  /** Sièges disponibles pour un trajet (seatmap temps réel) */
  @Get('trips/:tripId/seats')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_trip_seats',
    message: 'Too many requests.',
  })
  getTripSeats(
    @Param('tenantSlug') slug: string,
    @Param('tripId') tripId: string,
  ) {
    return this.service.getTripSeats(slug, tripId);
  }

  /** Annonces actives pour le tenant (optionnellement filtrées par station). */
  @Get('announcements')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_announcements',
    message: 'Too many requests.',
  })
  getAnnouncements(
    @Param('tenantSlug') slug: string,
    @Query('stationId') stationId?: string,
  ) {
    return this.service.getPublicAnnouncements(slug, stationId);
  }

  /** Flotte (photos, seatmaps) */
  @Get('fleet')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 30, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_fleet',
    message: 'Too many requests.',
  })
  getFleet(@Param('tenantSlug') slug: string) {
    return this.service.getFleet(slug);
  }

  /** Pages CMS (about, terms…) */
  @Get('pages')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_pages',
    message: 'Too many requests.',
  })
  getPages(
    @Param('tenantSlug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.getPages(slug, locale);
  }

  @Get('pages/:pageSlug')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_page',
    message: 'Too many requests.',
  })
  getPage(
    @Param('tenantSlug') slug: string,
    @Param('pageSlug') pageSlug: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.getPage(slug, pageSlug, locale);
  }

  /** Actualités (liste) */
  @Get('posts')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 30, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_posts',
    message: 'Too many requests.',
  })
  getPosts(
    @Param('tenantSlug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.getPosts(slug, locale);
  }

  /** Actualité détail (par slug) */
  @Get('posts/:postSlug')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_post_detail',
    message: 'Too many requests.',
  })
  getPost(
    @Param('tenantSlug') slug: string,
    @Param('postSlug') postSlug: string,
  ) {
    return this.service.getPostBySlug(slug, postSlug);
  }

  /** Pages footer (about, mentions, etc.) */
  @Get('footer-pages')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_footer_pages',
    message: 'Too many requests.',
  })
  getFooterPages(
    @Param('tenantSlug') slug: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.getFooterPages(slug, locale);
  }

  // ── Self-service annulation / remboursement ────────────────��────────────

  /**
   * Aperçu du montant remboursable avant annulation.
   * Le voyageur fournit son numéro de téléphone pour vérifier son identité.
   */
  @Get('tickets/:ticketRef/refund-preview')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 10, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_refund_preview',
    message: 'Too many requests. Please try again later.',
  })
  previewRefund(
    @Param('tenantSlug') slug: string,
    @Param('ticketRef') ticketRef: string,
    @Query('phone') phone: string,
  ) {
    return this.service.previewRefund(slug, ticketRef, phone);
  }

  /**
   * Demande d'annulation self-service par le voyageur.
   * Crée le remboursement basé sur la politique d'annulation du tenant.
   */
  @Post('tickets/:ticketRef/cancel')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 5, windowMs: 3600_000, keyBy: 'ip', suffix: 'portal_cancel',
    message: 'Cancellation limit reached (5/hour). Please try again later.',
  })
  requestCancellation(
    @Param('tenantSlug') slug: string,
    @Param('ticketRef') ticketRef: string,
    @Body() dto: { phone: string; reason?: string },
  ) {
    return this.service.requestCancellation(slug, ticketRef, dto);
  }

  // ── Colis (envoi + suivi public) ───────────────────────────────────────

  /**
   * Demande d'enlèvement de colis (anonyme).
   * Crée un Parcel en statut CREATED. Un agent appellera pour confirmer.
   * Rate limit strict : 5/h/IP — même cadence que l'annulation self-service.
   */
  @Post('parcel-pickup-request')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 5, windowMs: 3600_000, keyBy: 'ip', suffix: 'portal_parcel_pickup',
    message: 'Parcel pickup request limit reached (5/hour). Please try again later.',
  })
  createParcelPickupRequest(
    @Param('tenantSlug') slug: string,
    @Body() dto: CreateParcelPickupRequestDto,
  ) {
    return this.service.createParcelPickupRequest(slug, dto);
  }

  /** Suivi public d'un colis par code de suivi (tenant-scoped). */
  @Get('parcels/:trackingCode/track')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 30, windowMs: 60_000, keyBy: 'ip', suffix: 'portal_parcel_track',
    message: 'Too many tracking requests. Please wait a moment.',
  })
  trackParcel(
    @Param('tenantSlug') slug: string,
    @Param('trackingCode') trackingCode: string,
  ) {
    return this.service.trackParcelByCode(slug, trackingCode);
  }

  /** Création de réservation (rate limit strict) */
  @Post('booking')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 10, windowMs: 3600_000, keyBy: 'ip', suffix: 'portal_booking',
    message: 'Booking limit reached (10/hour). Please try again later.',
  })
  createBooking(
    @Param('tenantSlug') slug: string,
    @Body() dto: CreateBookingDto,
  ) {
    return this.service.createBooking(slug, {
      tripId: dto.tripId,
      passengers: dto.passengers.map(p => ({
        firstName:          p.firstName,
        lastName:           p.lastName,
        phone:              p.phone,
        email:              p.email,
        seatType:           p.seatType,
        wantsSeatSelection: p.wantsSeatSelection,
        seatNumber:         p.seatNumber,
      })),
      paymentMethod: dto.paymentMethod,
    });
  }
}
