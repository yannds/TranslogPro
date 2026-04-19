import {
  BadRequestException, Body, Controller, Get, Headers, Param, Patch, Post, Query,
} from '@nestjs/common';
import { FlightDeckService } from './flight-deck.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * Transitions de statut autorisées depuis le portail chauffeur. Tout ce qui
 * n'est pas dans cette liste doit passer par l'endpoint manager
 * `PATCH /trips/:id` (TRIP_UPDATE_AGENCY). La cohérence du state graph est
 * vérifiée côté service via TripStateService.
 */
const DRIVER_ALLOWED_STATUSES = ['BOARDING', 'IN_PROGRESS', 'COMPLETED'] as const;
type DriverAllowedStatus = typeof DRIVER_ALLOWED_STATUSES[number];

@Controller('tenants/:tenantId/flight-deck')
export class FlightDeckController {
  constructor(private readonly flightDeckService: FlightDeckService) {}

  @Get('active-trip')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_OWN])
  getActiveTrip(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.getActiveTripForDriver(tenantId, user.id);
  }

  @Get('trips/:tripId/detail')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_OWN])
  getTripDetail(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.getTripDetail(tenantId, tripId, user.id);
  }

  @Get('trips/:tripId/checklist')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_OWN])
  getChecklist(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.flightDeckService.getChecklist(tenantId, tripId, scope);
  }

  @Patch('checklist/:checklistId/complete')
  // Driver coche les items de SA checklist pré-départ. Le service vérifie que
  // le trajet lui appartient — scope .own fine-grained. Les managers ont aussi
  // TRIP_UPDATE_AGENCY pour compléter à distance en cas de support.
  @RequirePermission([Permission.TRIP_CHECK_OWN, Permission.TRIP_UPDATE_AGENCY])
  completeChecklist(
    @TenantId() tenantId: string,
    @Param('checklistId') checklistId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.flightDeckService.completeChecklist(tenantId, checklistId, user.id);
  }

  /**
   * Transition d'état de trajet initiée par le chauffeur :
   *   OPEN|PLANNED → BOARDING  (ouverture embarquement)
   *   BOARDING     → IN_PROGRESS  (départ effectif)
   *   IN_PROGRESS  → COMPLETED    (arrivée à destination)
   *
   * Permission : TRIP_LOG_EVENT_OWN (driver opérant son propre trajet) OU
   * TRIP_UPDATE_AGENCY (manager qui passe par l'endpoint tenant générique
   * habituellement, exposé ici pour la cohérence UX driver).
   *
   * Le service vérifie :
   *   1. Le trajet est bien assigné au chauffeur connecté (defense in depth)
   *   2. La transition est valide dans le state graph
   */
  @Post('trips/:tripId/status')
  @RequirePermission([Permission.TRIP_LOG_EVENT_OWN, Permission.TRIP_UPDATE_AGENCY])
  transitionStatus(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Body() body: { status: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!body?.status || !(DRIVER_ALLOWED_STATUSES as readonly string[]).includes(body.status)) {
      throw new BadRequestException(
        `Status invalide : attendu un de ${DRIVER_ALLOWED_STATUSES.join(' | ')}`,
      );
    }
    return this.flightDeckService.transitionTripStatus(
      tenantId,
      tripId,
      user.id,
      body.status as DriverAllowedStatus,
    );
  }

  @Get('trips/:tripId/passengers')
  @RequirePermission([Permission.TICKET_READ_AGENCY, Permission.TRIP_CHECK_OWN, Permission.MANIFEST_READ_OWN])
  getPassengers(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.flightDeckService.getPassengerList(tenantId, tripId);
  }

  /**
   * Compteurs live d'un trajet — consommé par les écrans BusScreen (affichage
   * embarqué) et QuaiScreen (panneau quai). Pas de cache, count() Prisma à
   * chaque appel pour refléter l'état DB en temps quasi-réel (polling 10s UI).
   *
   * Permission volontairement large : ces compteurs sont public-safe (aucun
   * nom, aucune PII), seulement des agrégats. `TRIP_READ_TENANT` couvre les
   * managers, `TRIP_READ_OWN` couvre les chauffeurs sur leur propre trajet.
   */
  @Get('trips/:tripId/live-stats')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_OWN])
  getLiveStats(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.flightDeckService.getTripLiveStats(tenantId, tripId);
  }

  /**
   * Check-in passager à l'entrée de la gare — crée/met à jour
   * `Traveler.CHECKED_IN`. Idempotent et monotone (ne rétrograde pas un
   * BOARDED). Déclenché par :
   *   - agent gare qui scanne le billet à l'arrivée du passager (principal)
   *   - chauffeur en mode fallback s'il n'y a pas d'agent gare (cas petites
   *     agences / hors heures d'ouverture gare)
   *
   * Permissions ORées : agent gare (`traveler.verify.agency` ou
   * `ticket.scan.agency`) OU chauffeur sur son propre trajet (`trip.check.own`)
   * OU manager (`trip.update.agency`).
   */
  @Post('trips/:tripId/passengers/:ticketId/check-in')
  @RequirePermission([
    Permission.TRAVELER_VERIFY_AGENCY,
    Permission.TICKET_SCAN_AGENCY,
    Permission.TRIP_CHECK_OWN,
    Permission.TRIP_UPDATE_AGENCY,
  ])
  checkInPassenger(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.flightDeckService.checkInPassenger(tenantId, tripId, ticketId, actor, idempotencyKey);
  }

  // L'agent gare est autorisé à valider l'embarquement en fallback (petites
  // agences sans chauffeur dédié ou relais si le chauffeur ne peut plus
  // scanner). D'où les permissions ORées au-delà de TRIP_CHECK_OWN.
  @Patch('trips/:tripId/passengers/:ticketId/board')
  @RequirePermission([
    Permission.TRIP_CHECK_OWN,
    Permission.TRAVELER_VERIFY_AGENCY,
    Permission.TRIP_UPDATE_AGENCY,
  ])
  boardPassenger(
    @TenantId() tenantId: string,
    @Param('tripId') tripId: string,
    @Param('ticketId') ticketId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.flightDeckService.boardPassenger(tenantId, tripId, ticketId, actor, idempotencyKey);
  }

  /**
   * Upsert du poids bagage d'un ticket — utilisé par l'agent de quai (balance)
   * ou le chauffeur avant départ. Perm LUGGAGE_WEIGH_AGENCY accordée à
   * AGENT_QUAI et TENANT_ADMIN par défaut.
   */
  @Patch('trips/:tripId/passengers/:ticketId/luggage')
  @RequirePermission(Permission.LUGGAGE_WEIGH_AGENCY)
  setLuggage(
    @TenantId() tenantId: string,
    @Param('ticketId') ticketId: string,
    @Body() body: { weightKg: number },
  ) {
    return this.flightDeckService.setLuggageWeight(tenantId, ticketId, body.weightKg);
  }

  @Get('schedule')
  @RequirePermission([Permission.TRIP_READ_TENANT, Permission.TRIP_READ_OWN])
  getSchedule(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.flightDeckService.getDriverSchedule(
      tenantId,
      user.id,
      new Date(from),
      new Date(to),
    );
  }
}
