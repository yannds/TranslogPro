import {
  Controller, Post, Body, BadRequestException, HttpCode, Req, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RetroClaimService } from './retro-claim.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { IsString, IsIn, IsNotEmpty, Length, Matches } from 'class-validator';
import { IsE164Phone } from '../../common/validators/is-e164-phone.validator';
import { TurnstileGuard, RequireCaptcha } from '../../common/captcha/turnstile.guard';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

/**
 * RetroClaimController — Phase 3 CRM.
 *
 * Routes (nécessitent session authentifiée CUSTOMER) :
 *   POST /tenants/:tenantId/customer/claim/initiate   — génère OTP
 *   POST /tenants/:tenantId/customer/claim/confirm    — vérifie OTP + lie
 *
 * Sécurité :
 *   - Auth CUSTOMER requise (permission data.feedback.submit.own est de base ;
 *     on utilise la même pour simplifier — l'action est one-shot et bénigne
 *     pour le user cible).
 *   - @Throttle 3/h/IP sur initiate, 10/h/IP sur confirm (5 essais * 2 OTPs).
 *   - Tous les messages d'erreur sont intentionnellement génériques pour
 *     empêcher l'énumération de numéros/colis.
 */

class InitiateRetroDto {
  @IsIn(['TICKET', 'PARCEL'])
  target!: 'TICKET' | 'PARCEL';

  @IsString() @IsNotEmpty() @Length(4, 128)
  code!: string;

  @IsString() @IsNotEmpty() @Length(6, 30) @IsE164Phone()
  phone!: string;
}

class ConfirmRetroDto extends InitiateRetroDto {
  @IsString() @Matches(/^\d{6}$/)
  otp!: string;
}

@Controller('tenants/:tenantId/customer/claim')
export class RetroClaimController {
  constructor(private readonly retro: RetroClaimService) {}

  /**
   * Lance la procédure de claim rétroactif.
   * - Auth CUSTOMER (`data.feedback.submit.own` = base minimale de tout
   *   CUSTOMER/voyageur) : on veut juste s'assurer que l'appelant est un user
   *   légitime qui va revendiquer SON propre historique.
   * - Rate-limit strict anti-abus.
   */
  @Post('initiate')
  @HttpCode(200)
  @UseGuards(RedisRateLimitGuard, TurnstileGuard)
  @RequireCaptcha()
  @Throttle({ default: { limit: 3, ttl: 3600_000 } })   // 3 / heure / IP (defense in depth)
  @RateLimit([
    { limit: 3, windowMs: 3600_000, keyBy: 'ip',    suffix: 'retro_claim_ip',
      message: 'Too many retro-claim attempts from this IP.' },
    { limit: 3, windowMs: 24 * 3600_000, keyBy: 'phone', suffix: 'retro_claim_phone',
      phonePath: 'phone',
      message: 'Too many retro-claim attempts for this phone number.' },
  ])
  @RequirePermission(Permission.FEEDBACK_SUBMIT_OWN)
  async initiate(
    @TenantId()  tenantId: string,
    @Body()      dto:      InitiateRetroDto,
    @Req()       req:      Request,
  ) {
    return this.retro.initiate(tenantId, {
      target:      dto.target,
      code:        dto.code,
      phone:       dto.phone,
      createdByIp: (req.ip ?? undefined),
    });
  }

  /**
   * Consomme l'OTP et lie Customer ↔ User authentifié.
   */
  @Post('confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 3600_000 } })  // 10 / heure / IP (5 essais × 2 OTPs max)
  @RequirePermission(Permission.FEEDBACK_SUBMIT_OWN)
  async confirm(
    @TenantId()    tenantId: string,
    @CurrentUser() actor:    CurrentUserPayload,
    @Body()        dto:      ConfirmRetroDto,
  ) {
    if (!actor?.id) throw new BadRequestException('auth_required');
    return this.retro.confirm(tenantId, {
      target: dto.target,
      code:   dto.code,
      phone:  dto.phone,
      otp:    dto.otp,
      userId: actor.id,
    });
  }
}
