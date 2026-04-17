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

  /** Actualités */
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
      passenger: {
        firstName: dto.passenger.firstName,
        lastName:  dto.passenger.lastName,
        phone:     dto.passenger.phone,
        email:     dto.passenger.email,
        seatType:  dto.passenger.seatType,
      },
      paymentMethod: dto.paymentMethod,
    });
  }
}
