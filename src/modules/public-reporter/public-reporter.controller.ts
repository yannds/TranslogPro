import { Controller, Post, Get, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PublicReporterService, PublicReportDto } from './public-reporter.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';
import { RedisRateLimitGuard, RateLimit } from '../../common/guards/redis-rate-limit.guard';

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
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
             ?? req.socket.remoteAddress
             ?? 'unknown';
    return this.publicReporterService.submit(tenantId, dto, ip);
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
