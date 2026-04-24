/**
 * TollPointService — registre partagé des péages / points de contrôle tenant.
 *
 * Responsabilités :
 *   1. CRUD du registre (scope strict tenantId)
 *   2. Détection automatique des TollPoints qui tombent sur l'itinéraire
 *      d'une route (proximité géographique à la polyline Google)
 *   3. Insertion en lot des péages détectés comme waypoints de la route
 *
 * Zéro magic number : le rayon de match géographique est lu depuis
 * PlatformConfig (défaut 2 km — distance raisonnable pour un péage bordant
 * une RN).
 */
import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { WaypointKind, TollDirection, Prisma } from '@prisma/client';

const MATCH_RADIUS_CONFIG_KEY = 'tolls.detectMatchRadiusKm';
const DEFAULT_MATCH_RADIUS_KM = 2;

export interface CreateTollPointDto {
  name:        string;
  coordinates: { lat: number; lng: number };
  kind?:       WaypointKind;
  tollCostXaf: number;
  direction?:  TollDirection;
  notes?:      string;
}

export interface UpdateTollPointDto {
  name?:        string;
  coordinates?: { lat: number; lng: number };
  kind?:        WaypointKind;
  tollCostXaf?: number;
  direction?:   TollDirection;
  notes?:       string;
}

export interface DetectedTollPoint {
  tollPointId:          string;
  name:                 string;
  kind:                 WaypointKind;
  tollCostXaf:          number;
  direction:            TollDirection;
  coordinates:          { lat: number; lng: number };
  distanceFromOriginKm: number;   // position estimée le long de la route
  matchDistanceKm:      number;   // écart à la polyline (≤ radius)
  alreadyLinked:        boolean;  // true si ce TollPoint est déjà un waypoint de la route
}

@Injectable()
export class TollPointService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────────────

  findAll(tenantId: string) {
    return this.prisma.tollPoint.findMany({
      where:   { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const tp = await this.prisma.tollPoint.findFirst({ where: { id, tenantId } });
    if (!tp) throw new NotFoundException('TollPoint introuvable');
    return tp;
  }

  async create(tenantId: string, dto: CreateTollPointDto) {
    validateCoords(dto.coordinates);
    if (dto.tollCostXaf < 0) throw new BadRequestException('tollCostXaf >= 0 requis');

    try {
      return await this.prisma.tollPoint.create({
        data: {
          tenantId,
          name:        dto.name.trim(),
          coordinates: dto.coordinates as unknown as Prisma.InputJsonValue,
          kind:        dto.kind ?? WaypointKind.PEAGE,
          tollCostXaf: dto.tollCostXaf,
          direction:   dto.direction ?? TollDirection.BOTH,
          notes:       dto.notes,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`Un péage du même nom existe déjà pour ce tenant`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateTollPointDto) {
    await this.findOne(tenantId, id); // throws 404 si absent
    if (dto.coordinates) validateCoords(dto.coordinates);
    if (dto.tollCostXaf !== undefined && dto.tollCostXaf < 0) {
      throw new BadRequestException('tollCostXaf >= 0 requis');
    }

    return this.prisma.tollPoint.update({
      where: { id },
      data: {
        ...(dto.name !== undefined        && { name: dto.name.trim() }),
        ...(dto.coordinates !== undefined && { coordinates: dto.coordinates as unknown as Prisma.InputJsonValue }),
        ...(dto.kind !== undefined        && { kind: dto.kind }),
        ...(dto.tollCostXaf !== undefined && { tollCostXaf: dto.tollCostXaf }),
        ...(dto.direction !== undefined   && { direction: dto.direction }),
        ...(dto.notes !== undefined       && { notes: dto.notes }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    // Les waypoints qui référencent ce péage voient leur FK passer à NULL (onDelete: SetNull).
    // Le tollCostXaf déjà override sur le waypoint est préservé.
    await this.prisma.tollPoint.delete({ where: { id } });
  }

  /**
   * Import depuis les waypoints existants — peuple le registre à partir des
   * péages/contrôles déjà saisis sur les routes mais non rattachés au registre.
   *
   * Contexte : quand un tenant a créé des routes avec des `Waypoint{kind!=STATION}`
   * avant d'utiliser le registre (ou sans détection auto), la page "Péages &
   * points de contrôle" apparaît vide. Cette opération les rapatrie :
   *   - scan `Waypoint` où `kind IN [PEAGE,POLICE,DOUANE,EAUX_FORETS,FRONTIERE,AUTRE]`
   *     ET `tollPointId IS NULL`
   *   - regroupe par (name trim + kind) — un même nom sur 2 kinds différents
   *     reste distinct (ex: "Lifoula" PEAGE vs "Lifoula" POLICE)
   *   - crée un `TollPoint` par groupe avec :
   *       • tollCostXaf = max des waypoints du groupe (conservateur)
   *       • coordinates = {lat:0,lng:0} placeholder → user complète ensuite
   *       • notes = marqueur "IMPORTED_FROM_WAYPOINTS" pour tracer + rappeler
   *   - backlink `Waypoint.tollPointId` vers le TollPoint créé (même nom+kind)
   *
   * Idempotent : relancer l'import n'écrase rien — les TollPoint du même
   * (tenant, name) existants ne sont pas dupliqués (contrainte UNIQUE).
   * Les waypoints déjà liés (tollPointId != null) sont ignorés.
   *
   * Retour : { imported, backlinked, skippedExisting } pour feedback UI.
   */
  async importFromWaypoints(tenantId: string): Promise<{
    imported:        number;  // nouveaux TollPoint créés
    backlinked:      number;  // waypoints dont tollPointId a été rempli
    skippedExisting: number;  // groupes où le TollPoint existait déjà (UNIQUE name)
  }> {
    const orphanWaypoints = await this.prisma.waypoint.findMany({
      where: {
        tollPointId: null,
        kind:        { not: WaypointKind.STATION },
        route:       { tenantId },
      },
      select: {
        id: true, name: true, kind: true, tollCostXaf: true,
      },
    });

    if (orphanWaypoints.length === 0) {
      return { imported: 0, backlinked: 0, skippedExisting: 0 };
    }

    // Regroupement (name normalisé + kind) — deux kinds différents ne fusionnent pas.
    type GroupKey = string;
    const groups = new Map<GroupKey, {
      name:         string;
      kind:         WaypointKind;
      maxCost:      number;
      waypointIds:  string[];
    }>();
    for (const wp of orphanWaypoints) {
      if (!wp.name || !wp.name.trim()) continue; // sans nom on ne peut pas grouper proprement
      const normName = wp.name.trim();
      const key = `${normName.toLowerCase()}|${wp.kind}`;
      const existing = groups.get(key);
      if (existing) {
        existing.maxCost = Math.max(existing.maxCost, wp.tollCostXaf ?? 0);
        existing.waypointIds.push(wp.id);
      } else {
        groups.set(key, {
          name:        normName,
          kind:        wp.kind,
          maxCost:     wp.tollCostXaf ?? 0,
          waypointIds: [wp.id],
        });
      }
    }

    // TollPoints existants (par name) — pour éviter les doublons de création
    const existingNames = new Set(
      (await this.prisma.tollPoint.findMany({
        where:  { tenantId },
        select: { name: true },
      })).map(tp => tp.name.toLowerCase()),
    );

    let imported = 0;
    let backlinked = 0;
    let skippedExisting = 0;

    await this.prisma.transact(async (tx) => {
      for (const group of groups.values()) {
        let tollPointId: string;

        if (existingNames.has(group.name.toLowerCase())) {
          // Un TollPoint de ce nom existe déjà — on récupère son id pour backlink
          // (évite doublon, respecte l'@@unique([tenantId, name])).
          const existingTp = await tx.tollPoint.findFirst({
            where:  { tenantId, name: { equals: group.name, mode: 'insensitive' } },
            select: { id: true },
          });
          if (!existingTp) {
            skippedExisting += group.waypointIds.length;
            continue;
          }
          tollPointId = existingTp.id;
          skippedExisting++;
        } else {
          const created = await tx.tollPoint.create({
            data: {
              tenantId,
              name:        group.name,
              kind:        group.kind,
              tollCostXaf: group.maxCost,
              direction:   TollDirection.BOTH,
              coordinates: { lat: 0, lng: 0 } as unknown as Prisma.InputJsonValue,
              notes:       'IMPORTED_FROM_WAYPOINTS — coordonnées GPS à compléter pour activer la détection automatique',
            },
          });
          tollPointId = created.id;
          imported++;
        }

        // Backlink des waypoints du groupe (préserve le tollCostXaf override
        // existant sur chaque waypoint — il prend le pas sur TollPoint.tollCostXaf).
        const res = await tx.waypoint.updateMany({
          where: { id: { in: group.waypointIds }, tollPointId: null },
          data:  { tollPointId },
        });
        backlinked += res.count;
      }
    });

    return { imported, backlinked, skippedExisting };
  }

  // ── Détection automatique sur une route ─────────────────────────────────

  /**
   * Pour une route donnée, scanne tous les TollPoints du tenant et retourne
   * ceux qui tombent à moins de matchRadiusKm de la polyline formée par les
   * stations GPS du trajet. Résultat ordonné par distance cumulée depuis origine.
   *
   * Usage typique : après création d'une nouvelle route Pointe-Noire → Brazza,
   * on propose les 7 péages déjà dans le registre qui jalonnent la RN1.
   */
  async detectOnRoute(tenantId: string, routeId: string): Promise<DetectedTollPoint[]> {
    const route = await this.prisma.route.findFirst({
      where:   { id: routeId, tenantId },
      include: {
        origin:      { select: { coordinates: true } },
        destination: { select: { coordinates: true } },
        waypoints:   {
          include: { station: { select: { coordinates: true } } },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!route) throw new NotFoundException('Route introuvable');

    const originC = pointFromJson(route.origin?.coordinates);
    const destC   = pointFromJson(route.destination?.coordinates);
    if (!originC || !destC) {
      throw new BadRequestException('Origine/destination sans coordonnées GPS — détection impossible');
    }

    // Polyline = liste des segments entre stations GPS consécutives. Les waypoints
    // sans GPS (péages existants justement) sont ignorés pour la géométrie.
    const anchors: Array<{ point: { lat: number; lng: number }; cumKm: number }> = [];
    anchors.push({ point: originC, cumKm: 0 });
    for (const wp of route.waypoints) {
      const p = pointFromJson(wp.station?.coordinates);
      if (p) anchors.push({ point: p, cumKm: wp.distanceFromOriginKm ?? 0 });
    }
    anchors.push({ point: destC, cumKm: route.distanceKm });

    const radius = await this.platformConfig.getNumber(MATCH_RADIUS_CONFIG_KEY)
      .catch(() => DEFAULT_MATCH_RADIUS_KM);

    const allTollPoints = await this.prisma.tollPoint.findMany({ where: { tenantId } });

    // Set des TollPointIds déjà liés à cette route (via Waypoint.tollPointId)
    const linkedIds = new Set<string>(
      route.waypoints.map(w => w.tollPointId).filter((x): x is string => !!x),
    );

    const matches: DetectedTollPoint[] = [];
    for (const tp of allTollPoints) {
      const coords = pointFromJson(tp.coordinates);
      if (!coords) continue;

      // Plus proche segment de la polyline
      let minDist = Infinity;
      let cumAtMatch = 0;
      for (let i = 0; i < anchors.length - 1; i++) {
        const { distKm, cumKm } = distanceToSegmentKm(
          coords,
          anchors[i].point,  anchors[i].cumKm,
          anchors[i + 1].point, anchors[i + 1].cumKm,
        );
        if (distKm < minDist) {
          minDist    = distKm;
          cumAtMatch = cumKm;
        }
      }

      if (minDist <= radius) {
        matches.push({
          tollPointId:          tp.id,
          name:                 tp.name,
          kind:                 tp.kind,
          tollCostXaf:          tp.tollCostXaf,
          direction:            tp.direction,
          coordinates:          coords,
          distanceFromOriginKm: Math.round(cumAtMatch * 10) / 10,
          matchDistanceKm:      Math.round(minDist * 100) / 100,
          alreadyLinked:        linkedIds.has(tp.id),
        });
      }
    }

    return matches.sort((a, b) => a.distanceFromOriginKm - b.distanceFromOriginKm);
  }

  /**
   * Insère une liste de TollPoints comme waypoints de la route (kind hérité, nom hérité,
   * tollCostXaf hérité — pas d'override). Skippe ceux déjà liés.
   */
  async attachDetected(tenantId: string, routeId: string, tollPointIds: string[]): Promise<{
    attached: number;
    skipped:  number;
  }> {
    const detected = await this.detectOnRoute(tenantId, routeId);
    const byId = new Map(detected.map(d => [d.tollPointId, d]));
    const toAttach = tollPointIds
      .map(id => byId.get(id))
      .filter((d): d is DetectedTollPoint => !!d && !d.alreadyLinked);

    if (toAttach.length === 0) {
      return { attached: 0, skipped: tollPointIds.length };
    }

    // Calcule l'ordre de chaque nouveau waypoint : intercale dans l'ordre existant
    // selon la distance depuis l'origine.
    const existing = await this.prisma.waypoint.findMany({
      where:   { routeId },
      orderBy: { order: 'asc' },
      select:  { id: true, order: true, distanceFromOriginKm: true },
    });

    let attached = 0;
    for (const d of toAttach) {
      // Trouve la position d'insertion
      const insertAfter = existing.filter(w => w.distanceFromOriginKm <= d.distanceFromOriginKm).length;
      const order = insertAfter + 1 + attached;

      // Décale tous les waypoints à order >= order vers +1
      await this.prisma.waypoint.updateMany({
        where: { routeId, order: { gte: order } },
        data:  { order: { increment: 1 } },
      });

      await this.prisma.waypoint.create({
        data: {
          routeId,
          kind:                 d.kind,
          name:                 d.name,
          order,
          distanceFromOriginKm: d.distanceFromOriginKm,
          tollCostXaf:          0, // pas d'override — on prend la valeur du TollPoint via la FK
          tollPointId:          d.tollPointId,
        },
      });
      attached++;
    }

    return { attached, skipped: tollPointIds.length - attached };
  }
}

// ─── Helpers géométriques purs (exportés pour tests) ─────────────────────────

function pointFromJson(raw: unknown): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const lat = typeof c['lat'] === 'number' ? c['lat'] : null;
  const lng = typeof c['lng'] === 'number' ? c['lng'] : null;
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function validateCoords(c: { lat: number; lng: number }) {
  if (typeof c.lat !== 'number' || typeof c.lng !== 'number') {
    throw new BadRequestException('coordinates.lat et coordinates.lng requis (nombres)');
  }
  if (c.lat < -90 || c.lat > 90 || c.lng < -180 || c.lng > 180) {
    throw new BadRequestException('coordinates hors bornes');
  }
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Distance d'un point P au segment AB, et distance cumulée estimée le long
 * du trajet au niveau de la projection (interpolation linéaire entre
 * cumKmA et cumKmB selon la position sur le segment).
 *
 * Approximation plan local (suffisante pour < 100 km) : on projette en
 * coordonnées équirectangulaires, on calcule la distance orthogonale, puis
 * on retourne le résultat en km.
 */
export function distanceToSegmentKm(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number }, cumKmA: number,
  b: { lat: number; lng: number }, cumKmB: number,
): { distKm: number; cumKm: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const latRef = toRad((a.lat + b.lat) / 2);
  const R = 6371;

  const toXY = (pt: { lat: number; lng: number }) => ({
    x: R * toRad(pt.lng) * Math.cos(latRef),
    y: R * toRad(pt.lat),
  });
  const A = toXY(a);
  const B = toXY(b);
  const P = toXY(p);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { distKm: haversineKm(p, a), cumKm: cumKmA };
  }
  let tt = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  tt = Math.max(0, Math.min(1, tt));
  const projX = A.x + tt * dx;
  const projY = A.y + tt * dy;
  const distKm = Math.sqrt((P.x - projX) ** 2 + (P.y - projY) ** 2);
  const cumKm  = cumKmA + tt * (cumKmB - cumKmA);
  return { distKm, cumKm };
}
