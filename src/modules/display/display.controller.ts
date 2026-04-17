/**
 * DisplayController — Endpoints publics pour écrans d'affichage (gares, kiosques).
 *
 * Sécurité Anti-Leak (PRD §IV.14) :
 *   - Aucune requête n'accède à la DB sans tenantId en condition racine.
 *   - Le stationId n'est jamais utilisé directement comme clé de lookup ;
 *     DisplayService le valide toujours contre le tenantId avant expansion.
 *   - Pas d'authentification requise sur ces routes (écrans publics),
 *     mais RlsMiddleware applique néanmoins le SET LOCAL app.tenant_id.
 *
 * Routes (pas de préfixe /api/v1 — gérée par main.ts) :
 *   GET tenants/:tenantId/stations/:stationId/display?scope=&view=
 *   GET tenants/:tenantId/buses/:busId/display
 *   GET tenants/:tenantId/parcels/track/:code
 */

import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DisplayService } from './display.service';
import { DisplayQueryDto } from './dto/display-query.dto';

@Controller('tenants/:tenantId')
export class DisplayController {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly display:  DisplayService,
  ) {}

  // ─── Affichage toutes gares (scope tenant) ────────────────────────────────────

  /**
   * GET /tenants/:tenantId/display
   *
   * Retourne tous les prochains trajets du tenant (pas de filtre gare).
   * Endpoint public pour les écrans d'affichage en mode "toutes les gares".
   */
  @Get('display')
  async tenantDisplay(
    @Param('tenantId') tenantId: string,
    @Query()           query:    DisplayQueryDto,
  ) {
    return this.display.getTenantDisplay(tenantId, query);
  }

  // ─── Affichage gare ───────────────────────────────────────────────────────────

  /**
   * GET /tenants/:tenantId/stations/:stationId/display
   *
   * Retourne les prochains trajets selon la hiérarchie :
   *   - scope=station (défaut ou config) → trajets de cette gare uniquement
   *   - scope=city                       → toutes les gares de la même ville
   *   - scope=tenant                     → tous les trajets actifs du tenant
   *
   * Le filtrage view (departures | arrivals | both) s'applique à tous les scopes.
   *
   * Isolation : stationId est validé comme appartenant à tenantId par DisplayService
   * avant toute expansion. Un ID forgé d'un autre tenant retournera 404.
   */
  @Get('stations/:stationId/display')
  async stationDisplay(
    @Param('tenantId')  tenantId:  string,
    @Param('stationId') stationId: string,
    @Query()            query:     DisplayQueryDto,
  ) {
    return this.display.getStationDisplay(tenantId, stationId, query);
  }

  // ─── Affichage bus ────────────────────────────────────────────────────────────

  /**
   * GET /tenants/:tenantId/buses/:busId/display
   *
   * Retourne l'état du bus et son prochain trajet actif.
   * Isolation garantie : busId filtrée par tenantId.
   */
  @Get('buses/:busId/display')
  async busDisplay(
    @Param('tenantId') tenantId: string,
    @Param('busId')    busId:    string,
  ) {
    // `include` et `select` sont mutuellement exclusifs dans Prisma — on n'utilise qu'`include`
    return this.prisma.bus.findFirst({
      where:   { id: busId, tenantId },   // isolation racine
      include: {
        trips: {
          where:   { status: { in: ['PLANNED', 'BOARDING', 'IN_PROGRESS'] } },
          orderBy: { departureScheduled: 'asc' },
          take:    1,
          include: {
            route: {
              include: {
                origin:      { select: { id: true, name: true, city: true } },
                destination: { select: { id: true, name: true, city: true } },
              },
            },
          },
        },
      },
    });
  }

  // ─── Tracking colis (public) ──────────────────────────────────────────────────

  /**
   * GET /tenants/:tenantId/parcels/track/:code
   *
   * Endpoint public de suivi colis.
   * GPS et données personnelles expurgées (RGPD).
   * Isolation : trackingCode filtré par tenantId.
   */
  @Get('parcels/track/:code')
  async trackParcel(
    @Param('tenantId') tenantId: string,
    @Param('code')     code:     string,
  ) {
    return this.prisma.parcel.findFirst({
      where:  { tenantId, trackingCode: code },  // isolation racine
      select: {
        trackingCode: true,
        status:       true,
        destination:  { select: { name: true, city: true } },
        createdAt:    true,
      },
    });
  }
}
