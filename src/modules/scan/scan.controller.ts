import { Controller, Get, Query } from '@nestjs/common';
import { ScanService } from './scan.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * Portail Agent Quai — lookup par code (QR ou saisie manuelle).
 *
 * Endpoints séparés par type pour éviter l'ambiguïté : l'agent sait s'il
 * scanne un billet ou un colis avant de scanner, ce qui évite qu'un mauvais
 * scan bascule dans le mauvais flux métier.
 */
@Controller('tenants/:tenantId/scan')
export class ScanController {
  constructor(private readonly scanService: ScanService) {}

  /**
   * Capacités de scan de l'utilisateur courant dans ce tenant.
   *
   * Retourne `{ canCheckIn, canBoard }`. Les UIs l'appellent au chargement
   * des écrans scan pour décider quels boutons/modes afficher — aucune
   * permission UI hardcodée côté client. Tenant qui désactive SCAN_BOARD
   * dans son blueprint ⇒ le bouton disparaît automatiquement.
   *
   * Pas de permission gate : n'importe quel utilisateur authentifié peut
   * interroger ses propres capacités. Le vrai check perm est dans les
   * transitions (/flight-deck/... ou WorkflowEngine).
   */
  @Get('capabilities')
  capabilities(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    // Les permissions runtime sont dans DB RolePermission. Le service se
    // charge de la lecture pour éviter un couplage entre le controller et
    // l'ORM ici.
    return this.scanService.getCapabilitiesByRole(tenantId, user.roleId);
  }

  /**
   * Scan d'un billet passager — recherche par `qrCode` ou `id`.
   *
   * `intent` (query) fixe l'acte attendu du scanner :
   *   - `check-in` : agent au guichet/gare — borne à CHECKED_IN
   *   - `board`    : chauffeur au bus — vise BOARDED
   *   - omis       : comportement historique (advance auto selon état)
   *
   * Permissions ORées : agent quai / agent gare / chauffeur / manager.
   */
  @Get('ticket')
  @RequirePermission([
    Permission.TICKET_SCAN_AGENCY,
    Permission.TRAVELER_VERIFY_AGENCY,
    Permission.TRIP_CHECK_OWN,
    Permission.TRIP_UPDATE_AGENCY,
  ])
  lookupTicket(
    @TenantId() tenantId: string,
    @Query('code') code: string,
    @Query('intent') intent?: string,
  ) {
    const normalizedIntent: 'check-in' | 'board' | null =
      intent === 'check-in' || intent === 'board' ? intent : null;
    return this.scanService.lookupTicket(tenantId, code, normalizedIntent);
  }

  /**
   * Scan d'un colis — recherche par `trackingCode` ou `id`.
   */
  @Get('parcel')
  @RequirePermission([
    Permission.PARCEL_SCAN_AGENCY,
    Permission.TRIP_UPDATE_AGENCY,
  ])
  lookupParcel(
    @TenantId() tenantId: string,
    @Query('code') code: string,
  ) {
    return this.scanService.lookupParcel(tenantId, code);
  }
}
