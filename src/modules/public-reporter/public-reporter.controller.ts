import { Controller, Post, Get, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PublicReporterService, PublicReportDto } from './public-reporter.service';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

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

  @Post()
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
