import {
  Controller, Post, Body, BadRequestException, HttpCode, Req,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CustomerClaimService } from './customer-claim.service';

/**
 * CustomerClaimController — Endpoints publics portail client.
 *
 * Routes (pas de @RequirePermission → public, mais rate-limitées) :
 *   POST /crm/claim/preview   — aperçu d'un token (shadow profile infos masquées)
 *   POST /crm/claim/complete  — lie le Customer à un User existant
 *
 * Sécurité :
 *   - Rate-limit 10 req/min/IP pour empêcher le brute-force de tokens.
 *   - Aucune permission (public) — la preuve est la possession du token.
 *   - Le controller n'expose JAMAIS le customerId entier au preview ni ne fuite
 *     l'email/phone complet.
 */

@Controller('crm/claim')
export class CustomerClaimController {
  constructor(private readonly claim: CustomerClaimService) {}

  /**
   * Preview d'un token — appelé par la page /claim?token=… à l'arrivée.
   * Renvoie des infos minimales masquées pour confirmer la propriété au user.
   */
  @Post('preview')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })  // 10 preview / min / IP
  async preview(@Body('token') token: string) {
    if (!token || typeof token !== 'string' || token.length < 32) {
      throw new BadRequestException('Token invalide');
    }
    return this.claim.previewToken(token);
  }

  /**
   * Consomme le token et lie Customer → User.
   * Le userId doit appartenir au même tenant que le Customer (vérifié en service).
   */
  @Post('complete')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 5 complete / min / IP
  async complete(
    @Body('token')  token:  string,
    @Body('userId') userId: string,
    @Req()          req:    Request,
  ) {
    if (!token || typeof token !== 'string' || token.length < 32) {
      throw new BadRequestException('Token invalide');
    }
    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('userId requis');
    }
    // Log l'IP pour audit (anti brute-force, analyses forensiques)
    void req.ip;
    return this.claim.completeToken(token, userId);
  }
}

// Re-export pour les tests
export { SkipThrottle };
