import {
  Controller, Get, Param, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { DocumentVerifyService } from './document-verify.service';
import {
  RateLimit,
  RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';

/**
 * Routes PUBLIQUES de vérification de documents — aucune auth.
 *
 *   GET /verify/ticket/:ticketId?q=TOKEN  — billet officiel HTML (HMAC requis)
 *   GET /verify/parcel/:trackingCode      — talon officiel HTML
 *
 * Workflow attendu :
 *   1. Le QR imprimé sur un billet/talon encode cette URL.
 *   2. Scan avec un smartphone → navigateur ouvre l'URL.
 *   3. Le backend rend le document officiel (même renderer que le back-office).
 *
 * Le user final peut VOIR un document authentique et signé ; une tentative
 * de falsification (HMAC invalide pour un ticket, trackingCode inexistant)
 * renvoie respectivement 401 / 404.
 */
@Controller('verify')
export class DocumentVerifyController {
  constructor(private readonly service: DocumentVerifyService) {}

  @Get('ticket/:ticketId')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'verify_ticket',
    message: 'Trop de consultations — réessayez dans quelques secondes',
  })
  async verifyTicket(
    @Param('ticketId') ticketId: string,
    @Query('q')        qrToken:  string,
    @Res()             res:      Response,
  ): Promise<void> {
    const html = await this.service.verifyAndRenderTicket(ticketId, qrToken);
    res.type('text/html; charset=utf-8');
    // Pas de cache côté navigateur — le statut peut évoluer (CANCELLED, BOARDED).
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  }

  @Get('parcel/:trackingCode')
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit: 60, windowMs: 60_000, keyBy: 'ip', suffix: 'verify_parcel',
    message: 'Trop de consultations — réessayez dans quelques secondes',
  })
  async verifyParcel(
    @Param('trackingCode') trackingCode: string,
    @Res()                 res:          Response,
  ): Promise<void> {
    const html = await this.service.renderParcelByTrackingCode(trackingCode);
    res.type('text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.send(html);
  }
}
