/**
 * TurnstileGuard — Guard Cloudflare CAPTCHA pour endpoints publics sensibles.
 *
 * Usage :
 *   @Post('booking')
 *   @UseGuards(TurnstileGuard)
 *   @RequireCaptcha()
 *   createBooking(...) {}
 *
 * Le token est lu dans le header `x-captcha-token` (envoyé par le widget
 * frontend). Le body peut aussi contenir `captchaToken` — on tolère les deux.
 *
 * Politique tenant :
 *   - `TenantBusinessConfig.captchaEnabled = true` → token requis.
 *   - `captchaEnabled = false` (défaut) → Guard laisse passer (feature flag
 *     par tenant). Utile le temps de configurer Turnstile chez Cloudflare
 *     et provisionner les clés par tenant (roadmap : clés par tenant dans
 *     Vault `tenants/{id}/captcha/turnstile`).
 *   - Service non configuré (`TurnstileService.isConfigured() = false`) →
 *     fail-open + log d'avertissement (dev local sans Cloudflare).
 *
 * Le tenant est résolu depuis :
 *   - req.params.tenantId (endpoints admin) ou
 *   - req.params.tenantSlug (endpoints portail public) — résolution DB
 *     pour obtenir le tenantId + config.
 */
import {
  Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { TurnstileService } from './turnstile.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';

export const REQUIRE_CAPTCHA_KEY = 'require_captcha';

/**
 * @RequireCaptcha() — marque l'endpoint comme nécessitant un CAPTCHA valide.
 * Sans cette annotation, le Guard laisse passer (opt-in).
 */
export const RequireCaptcha = () => SetMetadata(REQUIRE_CAPTCHA_KEY, true);

@Injectable()
export class TurnstileGuard implements CanActivate {
  private readonly logger = new Logger(TurnstileGuard.name);

  constructor(
    private readonly reflector:  Reflector,
    private readonly turnstile:  TurnstileService,
    private readonly prisma:     PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<boolean>(REQUIRE_CAPTCHA_KEY, context.getHandler());
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();

    // Résolution tenantId depuis paramètres de route
    const tenantId = await this.resolveTenantId(req);
    if (tenantId) {
      const bizConfig = await this.prisma.tenantBusinessConfig.findUnique({
        where:  { tenantId },
        select: { captchaEnabled: true },
      });
      if (!bizConfig?.captchaEnabled) {
        // Feature flag OFF pour ce tenant → passage libre (transition progressive)
        return true;
      }
    }

    // Service Turnstile non configuré → fail-open avec log
    if (!(await this.turnstile.isConfigured())) {
      this.logger.warn('[Turnstile] guard fail-open — service not configured (Vault platform/captcha/turnstile absent)');
      return true;
    }

    const token = this.extractToken(req);
    const remoteIp = this.extractIp(req);
    const result = await this.turnstile.verify(token, remoteIp);

    if (!result.ok) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message:    'Captcha invalide ou manquant',
          reason:     result.reason,
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }

  private extractToken(req: Request): string | null {
    const hdr = req.headers['x-captcha-token'];
    if (typeof hdr === 'string' && hdr) return hdr;
    const body = req.body as Record<string, unknown> | undefined;
    const fromBody = body?.captchaToken;
    return typeof fromBody === 'string' && fromBody ? fromBody : null;
  }

  private extractIp(req: Request): string | undefined {
    return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? undefined;
  }

  private async resolveTenantId(req: Request): Promise<string | null> {
    const params = req.params as { tenantId?: string; tenantSlug?: string } | undefined;
    if (params?.tenantId) return params.tenantId;
    if (!params?.tenantSlug) return null;

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }
}
