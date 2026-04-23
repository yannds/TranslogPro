import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { FareClassDefault } from '../tenant-settings/tenant-fare-class.service';
import { RoutingService } from '../routing/routing.service';
import type { SuggestDistanceResponse } from '../routing/routing.types';

export interface CreateRouteDto {
  name:          string;
  originId:      string;
  destinationId: string;
  distanceKm:    number;
  basePrice:     number;
}

/**
 * Structure de `Route.pricingOverrides` (JSON extensible).
 * Tous les champs sont optionnels : `null` ou `{}` = pas d'override, tenant
 * config s'applique.
 *
 *   taxes:       override par code taxe (rate + appliedToPrice)
 *   tolls:       péages ligne (override du rules.tollsXof legacy)
 *   luggage:     franchise / surcharge bagages spécifiques à cette ligne
 *   fareClasses: restreint la liste des classes vendues sur cette ligne
 */
export interface RoutePricingOverridesInput {
  taxes?: Record<string, { rate?: number; appliedToPrice?: boolean }>;
  tolls?: { override?: number };
  luggage?: { freeKg?: number; perExtraKg?: number };
  fareClasses?: { allowed?: string[] };
}

export interface UpdateRouteDto {
  name?:          string;
  originId?:      string;
  destinationId?: string;
  distanceKm?:    number;
  basePrice?:     number;
  pricingOverrides?: RoutePricingOverridesInput | null;
}

@Injectable()
export class RouteService {
  constructor(
    private readonly prisma:         PrismaService,
    private readonly platformConfig: PlatformConfigService,
    private readonly routing:        RoutingService,
  ) {}

  /**
   * Suggère une distance entre deux gares en utilisant le provider actif.
   * Les gares doivent appartenir au tenant et avoir des coordonnées GPS.
   * Retourne null si l'une des gares n'a pas de coordonnées.
   */
  async suggestDistance(
    tenantId: string,
    originId: string,
    destinationId: string,
  ): Promise<SuggestDistanceResponse | null> {
    const [originRow, destRow] = await Promise.all([
      this.prisma.station.findFirst({ where: { id: originId, tenantId }, select: { coordinates: true } }),
      this.prisma.station.findFirst({ where: { id: destinationId, tenantId }, select: { coordinates: true } }),
    ]);

    const extractCoords = (row: { coordinates: unknown } | null) => {
      if (!row?.coordinates || typeof row.coordinates !== 'object') return null;
      const c = row.coordinates as Record<string, unknown>;
      const lat = typeof c['lat'] === 'number' ? c['lat'] : null;
      const lng = typeof c['lng'] === 'number' ? c['lng'] : null;
      if (lat === null || lng === null) return null;
      return { lat, lng };
    };

    const origin = extractCoords(originRow);
    const dest   = extractCoords(destRow);
    if (!origin || !dest) return null;

    return this.routing.suggestDistance(origin, dest);
  }

  findAll(tenantId: string) {
    return this.prisma.route.findMany({
      where: { tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        _count:      { select: { trips: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
      },
    });
    if (!route) throw new NotFoundException(`Ligne ${id} introuvable dans ce tenant`);
    return route;
  }

  async create(tenantId: string, dto: CreateRouteDto) {
    const payload = this.validate(dto, /* partial */ false);
    await this.assertStationBelongsToTenant(tenantId, payload.originId!);
    await this.assertStationBelongsToTenant(tenantId, payload.destinationId!);
    if (payload.originId === payload.destinationId) {
      throw new BadRequestException('L\'origine et la destination doivent être différentes');
    }

    // Création Route + PricingRules par défaut dans une seule transaction.
    // Sans PricingRules active, la vente de billets est bloquée par le
    // PricingEngine ("Aucune règle tarifaire active"). On initialise donc avec
    // les valeurs du registre platform-config (zéro hardcoding) — l'admin peut
    // affiner ensuite via PageTenantBusinessRules / PricingRules dédiée.
    //
    // Note : taxRate et fareMultipliers sont gardés dans le payload JSON pour
    // rétro-compat avec l'ancien moteur, mais la source canonique est désormais
    // TenantTax[] et TenantFareClass (lus par PricingEngine en priorité).
    const [luggageFreeKg, luggagePerExtraKg, tollsXof, costPerKm, fareDefaults] = await Promise.all([
      this.platformConfig.getNumber('pricing.defaults.luggageFreeKg'),
      this.platformConfig.getNumber('pricing.defaults.luggagePerExtraKg'),
      this.platformConfig.getNumber('pricing.defaults.tollsXof'),
      this.platformConfig.getNumber('pricing.defaults.costPerKm'),
      this.platformConfig.getJson<FareClassDefault[]>('pricing.defaults.fareClasses'),
    ]);

    const fareMultipliers: Record<string, number> = {};
    for (const fc of fareDefaults) fareMultipliers[fc.code] = fc.multiplier;

    return this.prisma.transact(async (tx) => {
      const route = await tx.route.create({
        data: {
          tenantId,
          name:          payload.name!,
          originId:      payload.originId!,
          destinationId: payload.destinationId!,
          distanceKm:    payload.distanceKm!,
          basePrice:     payload.basePrice!,
        },
        include: {
          origin:      { select: { id: true, name: true, city: true } },
          destination: { select: { id: true, name: true, city: true } },
          _count:      { select: { trips: true } },
        },
      });

      // PricingRules par défaut si aucune n'existe déjà pour (tenant, route).
      // Le @@unique([tenantId, routeId]) protège contre la création en double.
      await tx.pricingRules.upsert({
        where:  { tenantId_routeId: { tenantId, routeId: route.id } },
        update: {}, // ne pas écraser si déjà configuré (update côté Route séparé)
        create: {
          tenantId, routeId: route.id,
          rules: {
            basePriceXof:      payload.basePrice!,
            // taxRate gardé à 0 : la fiscalité réelle vient de TenantTax[] +
            // éventuels overrides via Route.pricingOverrides. Le 0 est un no-op
            // dans le fallback legacy.
            taxRate:           0,
            tollsXof,
            costPerKm,
            luggageFreeKg,
            luggagePerExtraKg,
            fareMultipliers,
          },
        },
      });

      return route;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRouteDto) {
    const existing = await this.findOne(tenantId, id);
    const payload  = this.validate(dto, /* partial */ true);

    if (payload.originId      !== undefined) await this.assertStationBelongsToTenant(tenantId, payload.originId);
    if (payload.destinationId !== undefined) await this.assertStationBelongsToTenant(tenantId, payload.destinationId);

    const nextOrigin      = payload.originId      ?? existing.originId;
    const nextDestination = payload.destinationId ?? existing.destinationId;
    if (nextOrigin === nextDestination) {
      throw new BadRequestException('L\'origine et la destination doivent être différentes');
    }

    // updateMany ne supporte pas include → update + findUnique avec check strict tenant via where racine préalable
    const routeRes = await this.prisma.route.updateMany({
      where: { id, tenantId },
      data: {
        ...(payload.name          !== undefined ? { name:          payload.name }          : {}),
        ...(payload.originId      !== undefined ? { originId:      payload.originId }      : {}),
        ...(payload.destinationId !== undefined ? { destinationId: payload.destinationId } : {}),
        ...(payload.distanceKm    !== undefined ? { distanceKm:    payload.distanceKm }    : {}),
        ...(payload.basePrice     !== undefined ? { basePrice:     payload.basePrice }     : {}),
        // pricingOverrides : null explicite → reset à null (revient au tenant config).
        // Objet → persist tel quel (structure validée par `validate`).
        ...('pricingOverrides' in dto
          ? { pricingOverrides: (payload.pricingOverrides ?? null) as any }
          : {}),
      },
    });
    if (routeRes.count === 0) throw new NotFoundException(`Route ${id} introuvable`);
    return this.prisma.route.findFirst({
      where: { id, tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true } },
        destination: { select: { id: true, name: true, city: true } },
        _count:      { select: { trips: true } },
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const tripCount = await this.prisma.trip.count({ where: { tenantId, routeId: id } });
    if (tripCount > 0) {
      throw new ConflictException(
        `Impossible de supprimer cette ligne : ${tripCount} trajet(s) y sont rattachés. ` +
        'Annulez ou réaffectez les trajets avant de supprimer la ligne.',
      );
    }

    return this.prisma.transact(async (tx) => {
      // Waypoints : supprimer UNIQUEMENT celles dont le parent route est du tenant.
      // findOne() ci-dessus a déjà validé que route.id ∈ tenant ; ici defense-in-depth.
      await tx.waypoint.deleteMany({ where: { routeId: id, route: { tenantId } } });
      const res = await tx.route.deleteMany({ where: { id, tenantId } });
      if (res.count === 0) throw new NotFoundException(`Route ${id} introuvable`);
      return { deleted: true };
    });
  }

  // ── Waypoints (escales) ──────────────────────────────────────────────────

  async findOneWithWaypoints(tenantId: string, id: string) {
    const route = await this.prisma.route.findFirst({
      where: { id, tenantId },
      include: {
        origin:      { select: { id: true, name: true, city: true, coordinates: true } },
        destination: { select: { id: true, name: true, city: true, coordinates: true } },
        waypoints:   { include: { station: { select: { id: true, name: true, city: true, coordinates: true } } }, orderBy: { order: 'asc' } },
        segmentPrices: true,
      },
    });
    if (!route) throw new NotFoundException(`Ligne ${id} introuvable`);
    return route;
  }

  async setWaypoints(tenantId: string, routeId: string, waypoints: {
    kind?: string; stationId?: string; name?: string;
    order: number; distanceFromOriginKm: number;
    tollCostXaf?: number; checkpointCosts?: unknown[];
    isMandatoryStop?: boolean; estimatedWaitTime?: number;
  }[]) {
    await this.findOne(tenantId, routeId);

    // Invariant : STATION exige stationId, les autres kinds exigent name
    for (const wp of waypoints) {
      const kind = wp.kind ?? 'STATION';
      if (kind === 'STATION') {
        if (!wp.stationId) throw new BadRequestException(`Waypoint order ${wp.order} : stationId requis pour kind STATION`);
        await this.assertStationBelongsToTenant(tenantId, wp.stationId);
      } else {
        if (!wp.name) throw new BadRequestException(`Waypoint order ${wp.order} : name requis pour kind ${kind}`);
      }
    }

    // Remplacer tous les waypoints (atomique) — defense-in-depth via FK tenantId
    await this.prisma.transact(async (tx) => {
      await tx.waypoint.deleteMany({ where: { routeId, route: { tenantId } } });
      if (waypoints.length > 0) {
        await tx.waypoint.createMany({
          data: waypoints.map(wp => ({
            routeId,
            kind:                 (wp.kind ?? 'STATION') as any,
            stationId:            wp.stationId ?? null,
            name:                 wp.name ?? null,
            order:                wp.order,
            distanceFromOriginKm: wp.distanceFromOriginKm,
            tollCostXaf:          wp.tollCostXaf ?? 0,
            checkpointCosts:      wp.checkpointCosts ?? [],
            isMandatoryStop:      wp.isMandatoryStop ?? false,
            estimatedWaitTime:    wp.estimatedWaitTime,
          })),
        });
      }
    });

    // Auto-générer la matrice de prix (toutes paires, prix = 0 si pas encore configuré)
    await this.generateSegmentPriceMatrix(tenantId, routeId);

    return this.findOneWithWaypoints(tenantId, routeId);
  }

  // ── Matrice de prix segment ────────────────────────────────────────────────

  async getSegmentPrices(tenantId: string, routeId: string) {
    await this.findOne(tenantId, routeId);
    return this.prisma.routeSegmentPrice.findMany({
      where: { routeId },
      include: {
        fromStation: { select: { id: true, name: true } },
        toStation:   { select: { id: true, name: true } },
      },
      orderBy: [{ fromStationId: 'asc' }, { toStationId: 'asc' }],
    });
  }

  async setSegmentPrice(tenantId: string, routeId: string, fromStationId: string, toStationId: string, basePriceXaf: number) {
    await this.findOne(tenantId, routeId);
    return this.prisma.routeSegmentPrice.upsert({
      where: { routeId_fromStationId_toStationId: { routeId, fromStationId, toStationId } },
      update: { basePriceXaf },
      create: { routeId, fromStationId, toStationId, basePriceXaf },
    });
  }

  async bulkSetSegmentPrices(tenantId: string, routeId: string, prices: { fromStationId: string; toStationId: string; basePriceXaf: number }[]) {
    await this.findOne(tenantId, routeId);
    const results = [];
    for (const p of prices) {
      results.push(await this.prisma.routeSegmentPrice.upsert({
        where: { routeId_fromStationId_toStationId: { routeId, fromStationId: p.fromStationId, toStationId: p.toStationId } },
        update: { basePriceXaf: p.basePriceXaf },
        create: { routeId, fromStationId: p.fromStationId, toStationId: p.toStationId, basePriceXaf: p.basePriceXaf },
      }));
    }
    return results;
  }

  /**
   * Auto-génère toutes les paires (from, to) possibles sur un itinéraire.
   * Les stations sont : [origin, ...waypoints ordonnés, destination].
   * Seules les paires dans le sens du trajet sont créées (from.order < to.order).
   *
   * Proposition de prix :
   *  - Origine → Destination = basePrice de la route (toujours synchronisé)
   *  - Autres paires (nouvelles uniquement) = prix au prorata de la distance
   *    ex. si A→C = 500 km / 9000 XAF et B est à 200 km de A,
   *        alors A→B ≈ 200/500 × 9000 = 3600 XAF
   */
  private async generateSegmentPriceMatrix(tenantId: string, routeId: string) {
    const route = await this.prisma.route.findFirst({
      where: { id: routeId, tenantId },
      include: { waypoints: { orderBy: { order: 'asc' } } },
    });
    if (!route) return;

    const totalKm   = route.distanceKm || 1; // éviter division par 0
    const basePrice  = route.basePrice  || 0;

    // Tableau ordonné : [{ stationId, distanceFromOriginKm }]
    // Seuls les waypoints STATION entrent dans la matrice de prix — les péages/contrôles sont exclus.
    const stops = [
      { stationId: route.originId, distanceFromOriginKm: 0 },
      ...route.waypoints
        .filter(w => !w.kind || w.kind === 'STATION')
        .map(w => ({
          stationId:            w.stationId as string,
          distanceFromOriginKm: w.distanceFromOriginKm,
        })),
      { stationId: route.destinationId, distanceFromOriginKm: totalKm },
    ];

    // Supprimer les segments obsolètes (stations qui ne font plus partie du trajet)
    const validStationIds = stops.map(s => s.stationId);
    await this.prisma.routeSegmentPrice.deleteMany({
      where: {
        routeId,
        OR: [
          { fromStationId: { notIn: validStationIds } },
          { toStationId:   { notIn: validStationIds } },
        ],
      },
    });

    for (let i = 0; i < stops.length; i++) {
      for (let j = i + 1; j < stops.length; j++) {
        const isFullRoute = i === 0 && j === stops.length - 1;
        const segmentKm   = stops[j].distanceFromOriginKm - stops[i].distanceFromOriginKm;
        const proposed     = isFullRoute
          ? basePrice
          : Math.round((segmentKm / totalKm) * basePrice);

        if (isFullRoute) {
          // Origine → Destination : toujours synchronisé avec basePrice
          await this.prisma.routeSegmentPrice.upsert({
            where: {
              routeId_fromStationId_toStationId: {
                routeId,
                fromStationId: stops[i].stationId,
                toStationId:   stops[j].stationId,
              },
            },
            update: { basePriceXaf: basePrice },
            create: {
              routeId,
              fromStationId: stops[i].stationId,
              toStationId:   stops[j].stationId,
              basePriceXaf:  basePrice,
            },
          });
        } else {
          // Segments intermédiaires : proposer un prix au prorata, ne pas écraser un prix existant (> 0)
          const existing = await this.prisma.routeSegmentPrice.findUnique({
            where: {
              routeId_fromStationId_toStationId: {
                routeId,
                fromStationId: stops[i].stationId,
                toStationId:   stops[j].stationId,
              },
            },
          });
          if (!existing) {
            await this.prisma.routeSegmentPrice.create({
              data: {
                routeId,
                fromStationId: stops[i].stationId,
                toStationId:   stops[j].stationId,
                basePriceXaf:  proposed,
              },
            });
          }
        }
      }
    }
  }

  listStations(tenantId: string) {
    return this.prisma.station.findMany({
      where:   { tenantId },
      select:  { id: true, name: true, city: true, type: true, coordinates: true },
      orderBy: [{ city: 'asc' }, { name: 'asc' }],
    });
  }

  private validate(dto: CreateRouteDto | UpdateRouteDto, partial: boolean) {
    const out: UpdateRouteDto = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Le nom de la ligne est requis');
      out.name = name;
    } else if (!partial) {
      throw new BadRequestException('Le nom de la ligne est requis');
    }

    if (dto.originId !== undefined) {
      if (!dto.originId.trim()) throw new BadRequestException('Station d\'origine requise');
      out.originId = dto.originId.trim();
    } else if (!partial) {
      throw new BadRequestException('Station d\'origine requise');
    }

    if (dto.destinationId !== undefined) {
      if (!dto.destinationId.trim()) throw new BadRequestException('Station de destination requise');
      out.destinationId = dto.destinationId.trim();
    } else if (!partial) {
      throw new BadRequestException('Station de destination requise');
    }

    if (dto.distanceKm !== undefined) {
      if (typeof dto.distanceKm !== 'number' || Number.isNaN(dto.distanceKm) || dto.distanceKm < 0) {
        throw new BadRequestException('La distance doit être un nombre positif');
      }
      out.distanceKm = dto.distanceKm;
    } else if (!partial) {
      throw new BadRequestException('La distance est requise');
    }

    if (dto.basePrice !== undefined) {
      if (typeof dto.basePrice !== 'number' || Number.isNaN(dto.basePrice) || dto.basePrice < 0) {
        throw new BadRequestException('Le tarif de base doit être un nombre positif');
      }
      out.basePrice = dto.basePrice;
    } else if (!partial) {
      throw new BadRequestException('Le tarif de base est requis');
    }

    // pricingOverrides : null explicite = reset, objet = persist. Validation
    // structurelle minimale (structure attendue documentée sur RoutePricingOverridesInput).
    if ('pricingOverrides' in dto) {
      const po = (dto as UpdateRouteDto).pricingOverrides;
      if (po === null) {
        out.pricingOverrides = null;
      } else if (po !== undefined) {
        if (typeof po !== 'object' || Array.isArray(po)) {
          throw new BadRequestException('pricingOverrides doit être un objet');
        }
        if (po.taxes !== undefined) {
          if (typeof po.taxes !== 'object' || Array.isArray(po.taxes)) {
            throw new BadRequestException('pricingOverrides.taxes doit être un objet indexé par code taxe');
          }
          for (const [code, v] of Object.entries(po.taxes)) {
            if (!code.trim()) throw new BadRequestException('code taxe vide dans pricingOverrides.taxes');
            if (v.rate !== undefined && (typeof v.rate !== 'number' || v.rate < 0 || v.rate > 1)) {
              throw new BadRequestException(`pricingOverrides.taxes.${code}.rate invalide (0..1)`);
            }
          }
        }
        if (po.tolls?.override !== undefined) {
          if (typeof po.tolls.override !== 'number' || po.tolls.override < 0) {
            throw new BadRequestException('pricingOverrides.tolls.override doit être un nombre ≥ 0');
          }
        }
        if (po.luggage?.freeKg !== undefined) {
          if (typeof po.luggage.freeKg !== 'number' || po.luggage.freeKg < 0) {
            throw new BadRequestException('pricingOverrides.luggage.freeKg invalide');
          }
        }
        if (po.luggage?.perExtraKg !== undefined) {
          if (typeof po.luggage.perExtraKg !== 'number' || po.luggage.perExtraKg < 0) {
            throw new BadRequestException('pricingOverrides.luggage.perExtraKg invalide');
          }
        }
        out.pricingOverrides = po;
      }
    }

    return out;
  }

  /**
   * Retourne tous les points de contrôle non-STATION existants sur les lignes du tenant,
   * dédoublonnés par (kind, name). Sert d'autocomplete quand l'admin pose un nouveau
   * péage/contrôle — il retrouve les postes déjà nommés avec leur coût habituel.
   */
  async listCheckpoints(tenantId: string, kind?: string) {
    const where: Record<string, unknown> = {
      route: { tenantId },
      NOT: { kind: 'STATION' },
    };
    if (kind) where['kind'] = kind;

    const rows = await this.prisma.waypoint.findMany({
      where: where as any,
      select: { kind: true, name: true, tollCostXaf: true, estimatedWaitTime: true },
      orderBy: { name: 'asc' },
    });

    // Dédoublonner par (kind, name), garder le tollCostXaf le plus récent
    const seen = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      if (!r.name) continue;
      const key = `${r.kind}:${r.name.toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, r);
    }
    return Array.from(seen.values());
  }

  private async assertStationBelongsToTenant(tenantId: string, stationId: string) {
    const station = await this.prisma.station.findFirst({
      where:  { id: stationId, tenantId },
      select: { id: true },
    });
    if (!station) {
      throw new BadRequestException(`Station ${stationId} introuvable dans ce tenant`);
    }
  }
}
