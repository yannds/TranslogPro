/**
 * DisplayService
 *
 * Résout la logique de scope/view pour les écrans d'affichage gare.
 * Isolation multi-tenant : tenantId est la condition racine de TOUTE requête.
 * Un stationId ne peut jamais être utilisé sans être préalablement validé
 * comme appartenant au tenant concerné.
 *
 * Hiérarchie supportée : Tenant > Ville > Gare > Agence
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantConfigService } from '../../core/security/tenant-config.service';
import { DisplayQueryDto } from './dto/display-query.dto';

// Types internes
type Scope = 'station' | 'city' | 'tenant';
type View  = 'departures' | 'arrivals' | 'both';

@Injectable()
export class DisplayService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly configs:  TenantConfigService,
  ) {}

  // ─── API publique ─────────────────────────────────────────────────────────────

  /**
   * Retourne les trajets à afficher pour un écran de gare.
   *
   * @param tenantId  — isolation racine (toujours vérifié en premier)
   * @param stationId — gare de référence (validée comme appartenant au tenant)
   * @param query     — scope et view (avec fallback depuis TenantConfig)
   */
  async getStationDisplay(
    tenantId:  string,
    stationId: string,
    query:     DisplayQueryDto,
  ) {
    const config  = await this.configs.getConfig(tenantId);
    const scope   = (query.scope ?? config.displayScopeDefault) as Scope;
    const view    = (query.view  ?? 'both') as View;
    const horizon = new Date(Date.now() + config.displayHorizonHours * 3_600_000);

    // Résoudre les stationIds selon le scope
    // SÉCURITÉ : chaque résolution valide que stationId ∈ tenant avant toute expansion
    const stationIds = await this.resolveStationIds(tenantId, stationId, scope);

    // Construire le filtre de route selon le sens demandé
    const routeWhere = this.buildRouteFilter(stationIds, view);

    return this.prisma.trip.findMany({
      where: {
        tenantId,   // Condition racine anti-leak (toujours présente)
        status:     { in: ['PLANNED', 'BOARDING', 'IN_PROGRESS'] },
        departureScheduled: { gte: new Date(), lte: horizon },
        ...routeWhere,
      },
      include: {
        route: {
          include: {
            origin:      { select: { id: true, name: true, city: true } },
            destination: { select: { id: true, name: true, city: true } },
          },
        },
        bus: { select: { id: true, plateNumber: true, capacity: true } },
      },
      orderBy: { departureScheduled: 'asc' },
      take:    config.displayTakeLimit,
    });
  }

  // ─── Résolution de scope ─────────────────────────────────────────────────────

  private async resolveStationIds(
    tenantId:  string,
    stationId: string,
    scope:     Scope,
  ): Promise<string[]> {
    if (scope === 'station') {
      // Validation minimale : la gare doit appartenir au tenant
      await this.assertStationBelongsToTenant(tenantId, stationId);
      return [stationId];
    }

    if (scope === 'city') {
      // Récupère la ville de la gare de référence (avec vérification tenant)
      const station = await this.prisma.station.findFirst({
        where:  { id: stationId, tenantId },  // tenantId TOUJOURS en premier
        select: { city: true },
      });

      if (!station) throw new NotFoundException(`Station ${stationId} introuvable pour ce tenant`);

      if (!station.city) {
        // Gare sans ville définie → repli sur scope=station
        return [stationId];
      }

      // Toutes les gares de cette ville pour CE tenant — isolation garantie
      const siblings = await this.prisma.station.findMany({
        where:  { tenantId, city: station.city },  // index @@index([tenantId, city])
        select: { id: true },
      });

      return siblings.map(s => s.id);
    }

    // scope === 'tenant' : pas de filtre de route, tous les trajets du tenant
    // La sécurité est assurée par la condition tenantId dans la requête principale
    return [];
  }

  // ─── Construction du filtre Prisma ───────────────────────────────────────────

  private buildRouteFilter(stationIds: string[], view: View): object {
    if (stationIds.length === 0) {
      // scope=tenant : pas de restriction de gare, uniquement le tenantId
      return {};
    }

    const departures = { route: { originId:      { in: stationIds } } };
    const arrivals   = { route: { destinationId: { in: stationIds } } };

    if (view === 'departures') return departures;
    if (view === 'arrivals')   return arrivals;

    // 'both' : OR sur les deux directions
    return { OR: [departures, arrivals] };
  }

  /** Vérifie qu'une gare appartient au tenant — lève NotFoundException sinon. */
  private async assertStationBelongsToTenant(tenantId: string, stationId: string): Promise<void> {
    const exists = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(`Station ${stationId} introuvable pour ce tenant`);
  }
}
