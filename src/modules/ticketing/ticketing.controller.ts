import { Controller, Get, Post, Patch, Param, Body, Query, Headers } from '@nestjs/common';
import { TicketingService } from './ticketing.service';
import { IssueTicketDto, IssueBatchDto, ConfirmBatchDto } from './dto/issue-ticket.dto';
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

  /** Achat groupé — crée N billets en une transaction */
  @Post('batch')
  @RequirePermission(Permission.TICKET_CREATE_AGENCY)
  issueBatch(
    @TenantId() tenantId: string,
    @Body() dto: IssueBatchDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ticketingService.issueBatch(tenantId, dto, actor, idempotencyKey);
  }

  /** Confirmation groupée — confirme N billets, génère les QR codes */
  @Post('batch/confirm')
  @RequirePermission(Permission.TICKET_CREATE_AGENCY)
  confirmBatch(
    @TenantId() tenantId: string,
    @Body() dto: ConfirmBatchDto,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ticketingService.confirmBatch(tenantId, dto, actor, idempotencyKey);
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

  /** Confirmer le paiement d'un billet → signe le QR et passe en CONFIRMED */
  @Post(':id/confirm')
  @RequirePermission(Permission.TICKET_CREATE_AGENCY)
  confirm(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.ticketingService.confirm(tenantId, id, actor, idempotencyKey);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Scénarios no-show / rebook (2026-04-19)
  // ─────────────────────────────────────────────────────────────────────────

  /** Marquer no-show (agent quai / scheduler) — CONFIRMED|CHECKED_IN → NO_SHOW */
  @Post(':id/no-show')
  @RequirePermission(Permission.TICKET_NOSHOW_MARK_AGENCY)
  markNoShow(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.ticketingService.markNoShow(tenantId, id, actor);
  }

  /** Rebook sur le prochain trajet disponible (même route, aujourd'hui / demain). */
  @Post(':id/rebook/next-available')
  @RequirePermission([Permission.TICKET_REBOOK_AGENCY, Permission.TICKET_REBOOK_OWN])
  rebookNextAvailable(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.ticketingService.rebookNextAvailable(tenantId, id, actor);
  }

  /** Rebook sur un trajet futur spécifique. Body: { newTripId } */
  @Post(':id/rebook/later')
  @RequirePermission([Permission.TICKET_REBOOK_AGENCY, Permission.TICKET_REBOOK_OWN])
  rebookLater(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body('newTripId') newTripId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.ticketingService.rebookLater(tenantId, id, newTripId, actor);
  }

  /**
   * Demande de remboursement pour un billet raté (no-show / annulation client).
   * Le service applique automatiquement la pénalité no-show (si config activée)
   * et les paliers de pénalité d'annulation.
   * Body: { reason?, waive? }  — `waive` nécessite perm `refund.waive_penalty`.
   */
  @Post(':id/refund-request')
  @RequirePermission([Permission.REFUND_REQUEST_OWN, Permission.TICKET_CANCEL_AGENCY])
  requestRefundForMissed(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Body('reason') reason?: 'NO_SHOW' | 'CLIENT_CANCEL' | 'TRIP_CANCELLED',
    @Body('waive') waive?: boolean,
  ) {
    // TODO: vérifier côté guard que `waive=true` est réservé aux titulaires
    // de la perm `control.refund.waive_penalty.tenant` (tracé audit).
    return this.ticketingService.requestRefundForMissedTicket(
      tenantId, id, actor, reason ?? 'NO_SHOW', 'CUSTOMER', waive ?? false,
    );
  }

  @Get()
  @RequirePermission(Permission.TICKET_READ_AGENCY)
  findByTrip(
    @TenantId() tenantId: string,
    @ScopeCtx() scope: ScopeContext,
    @Query('tripId') tripId?: string,
    @Query('status') status?: string,
  ) {
    return this.ticketingService.findMany(tenantId, tripId, status ? { status } : undefined);
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
