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
   * Retourne TOUS les trajets du tenant (mode "Toutes les gares").
   */
  async getTenantDisplay(tenantId: string, query: DisplayQueryDto) {
    return this.getStationDisplay(tenantId, '__tenant__', { ...query, scope: 'tenant' });
  }

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
    // Résoudre les stationIds selon le scope
    const stationIds = await this.resolveStationIds(tenantId, stationId, scope);
    const routeWhere = this.buildRouteFilter(stationIds, view);

    // Lookback = début de la journée courante
    const lookback = new Date();
    lookback.setHours(0, 0, 0, 0);

    // Horizon configurable depuis la config tenant
    const horizon = new Date(Date.now() + config.displayHorizonHours * 3_600_000);

    const baseWhere = {
      tenantId,
      status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'IN_PROGRESS_DELAYED'] },
      ...routeWhere,
    };
    const selectClause = {
      id: true, status: true, departureScheduled: true, arrivalScheduled: true,
      displayNote: true, displayColor: true,
      route: {
        select: {
          name: true,
          origin:      { select: { id: true, name: true, city: true } },
          destination: { select: { id: true, name: true, city: true } },
          waypoints: {
            select: { station: { select: { name: true, city: true } }, order: true },
            orderBy: { order: 'asc' as const },
          },
        },
      },
      bus: { select: { id: true, plateNumber: true, capacity: true, agencyId: true } },
    };

    // 1. Chercher les trajets dans la fenêtre [début de journée … horizon]
    let trips = await this.prisma.trip.findMany({
      where:   { ...baseWhere, departureScheduled: { gte: lookback, lte: horizon } },
      select:  selectClause,
      orderBy: { departureScheduled: 'asc' },
      take:    config.displayTakeLimit,
    });

    // 2. Si aucun trajet trouvé → chercher les prochains disponibles (7 jours max)
    if (trips.length === 0) {
      const extendedHorizon = new Date(Date.now() + 7 * 24 * 3_600_000);
      trips = await this.prisma.trip.findMany({
        where:   { ...baseWhere, departureScheduled: { gte: new Date(), lte: extendedHorizon } },
        select:  selectClause,
        orderBy: { departureScheduled: 'asc' },
        take:    config.displayTakeLimit,
      });
    }

    return trips;
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

  // ─── Affichage quai (Platform + current/next trip + pax + colis) ─────────────

  /**
   * Retourne les données enrichies d'un quai pour l'écran d'affichage QuaiScreen.
   *
   * Sélection du trajet affiché :
   *   1. Si platform.currentTripId est défini → ce trajet (assigné explicitement)
   *   2. Sinon → prochain trajet de la station (originId == stationId) en
   *      statut PLANNED/BOARDING/IN_PROGRESS, trié par departureScheduled asc
   *
   * Agrégats temps réel :
   *   - passengersConfirmed = tickets CONFIRMED/CHECKED_IN
   *   - passengersOnBoard   = tickets CHECKED_IN
   *   - parcelsLoaded       = parcels.count via shipments du trip
   */
  async getPlatformDisplay(tenantId: string, platformId: string) {
    const platform = await this.prisma.platform.findFirst({
      where:  { id: platformId, tenantId },
      include: { station: { select: { id: true, name: true, city: true } } },
    });
    if (!platform) throw new NotFoundException(`Quai ${platformId} introuvable`);

    // Résolution du trip affiché — priorité à currentTripId, sinon next departing
    const tripWhereBase = {
      tenantId,
      status: { in: ['PLANNED', 'OPEN', 'BOARDING', 'IN_PROGRESS', 'IN_PROGRESS_DELAYED'] },
    };
    const trip = platform.currentTripId
      ? await this.prisma.trip.findFirst({
          where: { id: platform.currentTripId, tenantId },
          include: {
            route: {
              include: {
                origin:      { select: { id: true, name: true, city: true } },
                destination: { select: { id: true, name: true, city: true } },
                waypoints: {
                  orderBy: { order: 'asc' },
                  include: { station: { select: { name: true, city: true } } },
                },
              },
            },
            bus: { select: { id: true, plateNumber: true, model: true, capacity: true } },
          },
        })
      : await this.prisma.trip.findFirst({
          where: {
            ...tripWhereBase,
            route: { originId: platform.stationId },
          },
          include: {
            route: {
              include: {
                origin:      { select: { id: true, name: true, city: true } },
                destination: { select: { id: true, name: true, city: true } },
                waypoints: {
                  orderBy: { order: 'asc' },
                  include: { station: { select: { name: true, city: true } } },
                },
              },
            },
            bus: { select: { id: true, plateNumber: true, model: true, capacity: true } },
          },
          orderBy: { departureScheduled: 'asc' },
        });

    // Driver (Staff → User) — driverId est scalaire sur Trip, pas de relation Prisma
    const driver = trip?.driverId
      ? await this.prisma.staff.findUnique({
          where:  { id: trip.driverId },
          select: { id: true, user: { select: { name: true, email: true } } },
        })
      : null;

    // Agrégats passagers + colis — uniquement si un trip est affiché.
    //
    // Sources volontairement alignées sur `flight-deck.getTripLiveStats` pour
    // que QuaiScreen et BusScreen affichent les mêmes chiffres pour un même
    // trip :
    //   - passengersOnBoard   = Traveler.BOARDED  (acte d'embarquement bus)
    //   - passengersCheckedIn = Traveler.CHECKED_IN + BOARDED (présence gare)
    //   - passengersConfirmed = Ticket.CONFIRMED + CHECKED_IN (billets payés)
    //
    // Avant le correctif, `passengersOnBoard` lisait Ticket.CHECKED_IN alors
    // que l'action "Embarquer" écrit sur Traveler — les écrans quai
    // restaient bloqués à 0 même après 38 embarquements réels.
    //
    // `parcelsTotal` = colis attendus sur ce trip (hors CANCELLED), utile pour
    // que l'UI affiche "chargement terminé" quand loaded === total.
    const [
      passengersConfirmed, passengersOnBoard, passengersCheckedIn,
      parcelsLoaded, parcelsTotal,
    ] = trip
      ? await Promise.all([
          this.prisma.ticket.count({
            where: { tenantId, tripId: trip.id, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
          }),
          this.prisma.traveler.count({
            where: { tenantId, tripId: trip.id, status: 'BOARDED' },
          }),
          this.prisma.traveler.count({
            where: { tenantId, tripId: trip.id, status: { in: ['CHECKED_IN', 'BOARDED'] } },
          }),
          this.prisma.parcel.count({
            where: {
              tenantId,
              shipment: { tripId: trip.id },
              status: { in: ['LOADED', 'IN_TRANSIT'] },
            },
          }),
          this.prisma.parcel.count({
            where: {
              tenantId,
              shipment: { tripId: trip.id },
              status: { notIn: ['CANCELLED'] },
            },
          }),
        ])
      : [0, 0, 0, 0, 0];

    const via = trip?.route?.waypoints
      ?.map(w => w.station.city || w.station.name)
      .filter(Boolean)
      .join(' · ') ?? '';

    const destinationCity = trip?.route?.destination?.city
      ?? trip?.route?.destination?.name
      ?? '';
    const destinationCode = destinationCity
      ? destinationCity.slice(0, 3).toUpperCase()
      : '—';

    // statusId affiché = statut du trip si présent, sinon statut du quai
    const statusId = trip?.status ?? platform.status;

    // Retard en minutes — basé sur l'écart now vs departureScheduled dès que
    // l'heure est dépassée et tant que le trajet n'est pas terminé. QuaiScreen
    // affiche un badge rouge et pousse un message dans le ticker si > 0.
    const scheduled = trip?.departureScheduled ? trip.departureScheduled.getTime() : null;
    const isTerminal = statusId === 'COMPLETED' || statusId === 'CANCELLED';
    const delayMinutes = scheduled && !isTerminal && Date.now() > scheduled
      ? Math.floor((Date.now() - scheduled) / 60_000)
      : 0;

    return {
      id:                    platform.id,
      code:                  platform.code,
      name:                  platform.name,
      stationId:             platform.stationId,
      stationName:           platform.station.name,
      stationCity:           platform.station.city,
      capacity:              trip?.bus?.capacity ?? platform.capacity,
      statusId,
      delayMinutes,
      // ── Trip (null si aucun trajet affecté/à venir) ──
      tripId:                trip?.id ?? null,
      destination:           destinationCity,
      destinationCode,
      via,
      departureTime:         trip?.departureScheduled
        ? new Date(trip.departureScheduled).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : '',
      departAt:              trip?.departureScheduled?.toISOString() ?? null,
      busPlate:              trip?.bus?.plateNumber ?? '—',
      busModel:              trip?.bus?.model ?? '',
      driverName:            driver?.user?.name ?? '',
      agencyName:            '',
      passengersConfirmed,
      passengersOnBoard,
      passengersCheckedIn,
      parcelsLoaded,
      parcelsTotal,
    };
  }
}
