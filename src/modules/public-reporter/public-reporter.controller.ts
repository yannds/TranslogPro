import {
  Controller, Post, Get, Body, Param, Query, Req, UseGuards, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { PublicReporterService, PublicReportDto } from './public-reporter.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

function extractIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
       ?? req.socket.remoteAddress
       ?? 'unknown';
}

/**
 * Routes publiques (POST /report) — pas d'auth.
 * Routes Dispatch (GET /list) — SAFETY_MONITOR_GLOBAL.
 *
 * tenantId sur /report est extrait du path param directement
 * (endpoint public, pas de session).
 */
@Controller('public/:tenantId/report')
export class PublicReporterController {
  constructor(private readonly publicReporterService: PublicReporterService) {}

  /**
   * Rate limit : 5 signalements / heure / IP (PRD §IV.16)
   * Sliding window Redis — pas de session requise, clé = IP.
   */
  @Post()
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    5,
    windowMs: 60 * 60 * 1_000,
    keyBy:    'ip',
    suffix:   'public_report',
    message:  'Limite de signalements atteinte (5/heure). Vos données GPS seront supprimées sous 24h (RGPD).',
  })
  submit(
    @Param('tenantId') tenantId: string,
    @Body() dto: PublicReportDto,
    @Req() req: Request,
  ) {
    return this.publicReporterService.submit(tenantId, dto, extractIp(req));
  }

  @Get('list')
  @RequirePermission(Permission.SAFETY_MONITOR_GLOBAL)
  list(
    @Param('tenantId') tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.publicReporterService.listForDispatch(tenantId, status);
  }
}

/**
 * Portail citoyen — endpoint "no-slug" : tenantId résolu depuis le Host
 * (TenantHostMiddleware pose `req.resolvedHostTenant`). Permet au frontend
 * public d'appeler `POST /api/public/report` sans exposer l'UUID tenant.
 */
@Controller('public/report')
export class PublicReporterHostController {
  constructor(private readonly publicReporterService: PublicReporterService) {}

  /** Même rate-limit que la version "par slug" : 5/h/IP. */
  @Post()
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({
    limit:    5,
    windowMs: 60 * 60 * 1_000,
    keyBy:    'ip',
    suffix:   'public_report',
    message:  'Limite de signalements atteinte (5/heure). Vos données GPS seront supprimées sous 24h (RGPD).',
  })
  submit(
    @Body() dto: PublicReportDto,
    @Req() req: Request,
  ) {
    const tenantId = req.resolvedHostTenant?.tenantId;
    if (!tenantId) {
      throw new BadRequestException(
        "Domaine non reconnu : le signalement doit être envoyé depuis le sous-domaine d'un transporteur.",
      );
    }
    return this.publicReporterService.submit(tenantId, dto, extractIp(req));
  }

  /**
   * Infos publiques du tenant courant (résolu depuis le Host) pour afficher
   * le nom/marque sur la page de signalement sans exposer le tenantId.
   */
  @Get('tenant-info')
  tenantInfo(@Req() req: Request) {
    const host = req.resolvedHostTenant;
    if (!host?.tenantId) {
      throw new BadRequestException('Domaine non reconnu');
    }
    return {
      tenantId: host.tenantId,
      slug:     host.slug ?? null,
    };
  }
}
