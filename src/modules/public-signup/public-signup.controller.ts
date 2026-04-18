import {
  Controller, Post, Get, Body, Req, HttpCode, UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  RateLimit, RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';
import { PublicSignupService } from './public-signup.service';
import { WaitlistSubmitDto } from './dto/waitlist.dto';
import { PublicSignupDto } from './dto/signup.dto';

function extractIp(req: Request): string {
  if (process.env.NODE_ENV === 'production') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
    }
  }
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

function extractUa(req: Request): string {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 512) : '';
}

/**
 * Endpoints publics d'inscription à la plateforme SaaS :
 *
 *   POST /api/public/waitlist    — capture d'email early-access (rate-limit 5/h/IP)
 *   GET  /api/public/plans       — catalogue des plans visibles (sans auth)
 *   POST /api/public/signup      — création complète d'un tenant + admin (rate-limit 3/h/IP)
 *
 * Aucun permission guard (pas de @RequirePermission() → PermissionGuard skippe).
 * Anti-abus : rate-limit Redis sliding window + honeypot côté DTO.
 */
@Controller('public')
export class PublicSignupController {
  constructor(private readonly service: PublicSignupService) {}

  /**
   * Liste les plans publics (landing `/pricing`, étape 3 du signup).
   * Pas de rate-limit : endpoint en lecture pure, cacheable côté CDN ultérieurement.
   */
  @Get('plans')
  async listPlans() {
    return { plans: await this.service.listPublicPlans() };
  }

  @Post('waitlist')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'public_waitlist' })
  async submitWaitlist(
    @Body() dto: WaitlistSubmitDto,
    @Req()  req: Request,
  ): Promise<{ ok: true }> {
    // Honeypot : si rempli, on renvoie un succès silencieux (ne pas informer le bot).
    if (dto.company_website && dto.company_website.length > 0) {
      return { ok: true };
    }
    return this.service.submitWaitlist(dto, { ip: extractIp(req), ua: extractUa(req) });
  }

  @Post('signup')
  @HttpCode(201)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'public_signup' })
  async signup(
    @Body() dto: PublicSignupDto,
    @Req()  req: Request,
  ) {
    if (dto.company_website && dto.company_website.length > 0) {
      // Honeypot déclenché : on ne crée RIEN mais on ne donne pas d'indice au bot.
      throw new BadRequestException('Requête invalide');
    }
    return this.service.signup(dto, { ip: extractIp(req), ua: extractUa(req) });
  }
}
