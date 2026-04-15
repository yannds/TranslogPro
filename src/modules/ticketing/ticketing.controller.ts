import { Controller, Get, Post, Patch, Param, Body, Query, Headers } from '@nestjs/common';
import { TicketingService } from './ticketing.service';
import { IssueTicketDto } from './dto/issue-ticket.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/tickets')
export class TicketingController {
  constructor(private readonly ticketingService: TicketingService) {}

  @Post()
  @RequirePermission(Permission.TICKET_CREATE_AGENCY)
  issue(
    @TenantId() tenantId: string,
    @Body() dto: IssueTicketDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ticketingService.issue(tenantId, dto, actor, idempotencyKey);
  }

  /** Scan QR — check-in + embarquement */
  @Post('verify-qr')
  @RequirePermission(Permission.TICKET_SCAN_AGENCY)
  verifyQr(
    @TenantId() tenantId: string,
    @Body('qrToken') qrToken: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.ticketingService.validate(tenantId, qrToken, actor);
  }

  @Post(':id/cancel')
  @RequirePermission(Permission.TICKET_CANCEL_AGENCY)
  cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Body('reason') reason?: string,
  ) {
    return this.ticketingService.cancel(tenantId, id, actor, reason);
  }

  @Get()
  @RequirePermission(Permission.TICKET_READ_AGENCY)
  findByTrip(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('tripId') tripId?: string,
  ) {
    return this.ticketingService.findMany(tenantId, tripId);
  }

  /**
   * "Mes voyages" — billets du CUSTOMER courant (filtré passengerId = actor.id).
   * Permission .own : tout client connecté peut consulter ses propres billets.
   * Le filtre est forcé côté service ; aucun query param ne l'override.
   */
  @Get('my')
  @RequirePermission(Permission.TICKET_READ_OWN)
  findMine(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.ticketingService.findMine(tenantId, actor.id);
  }

  @Get(':id')
  @RequirePermission(Permission.TICKET_READ_AGENCY)
  findOne(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.ticketingService.findOne(tenantId, id);
  }

  /** Public tracking — aucune auth requise, tenantId depuis path */
  @Get('track/:code')
  track(@Param('tenantId') tenantId: string, @Param('code') code: string) {
    return this.ticketingService.trackByCode(tenantId, code);
  }
}
