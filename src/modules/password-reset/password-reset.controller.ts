import {
  Controller, Post, Body, Req, HttpCode, UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PasswordResetService } from './password-reset.service';
import { RequestPasswordResetDto, CompletePasswordResetDto } from './dto/password-reset.dto';
import {
  RateLimit,
  RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';

function extractIp(req: Request): string {
  if (process.env.NODE_ENV === 'production') {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? req.ip ?? '';
    }
  }
  return req.ip ?? req.socket?.remoteAddress ?? '';
}

/**
 * Routes publiques du reset de mot de passe.
 *
 *   POST /api/auth/password-reset/request    — "mot de passe oublié"
 *   POST /api/auth/password-reset/complete   — finalisation via token
 *
 * Les routes admin (reset pour un user, reset batch) sont exposées par
 * TenantIamController (scope tenant, permission IAM_MANAGE_TENANT).
 */
@Controller('auth/password-reset')
export class PasswordResetController {
  constructor(private readonly service: PasswordResetService) {}

  /**
   * Auto-service : réponse TOUJOURS 200 + même payload, même si l'email
   * n'existe pas. Évite l'énumération de comptes.
   *
   * Rate-limit : 3 req / heure / IP.
   */
  @Post('request')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'auth_pw_reset_req' })
  async request(
    @Body() dto: RequestPasswordResetDto,
    @Req()  req: Request,
  ): Promise<{ ok: true }> {
    await this.service.initiateBySelf(dto.email, extractIp(req));
    return { ok: true };
  }

  /**
   * Finalisation : token + nouveau mot de passe.
   * Rate-limit : 5 req / heure / IP (brute force du token impossible — 256 bits).
   */
  @Post('complete')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60 * 60_000, keyBy: 'ip', suffix: 'auth_pw_reset_done' })
  async complete(
    @Body() dto: CompletePasswordResetDto,
    @Req()  req: Request,
  ): Promise<{ ok: true }> {
    await this.service.complete(dto.token, dto.newPassword, extractIp(req));
    return { ok: true };
  }
}
