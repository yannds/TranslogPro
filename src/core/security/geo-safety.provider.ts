/**
 * GeoSafetyProvider
 *
 * Source unique de vérité pour tous les calculs géo-spatiaux de sécurité.
 * Centralise la formule de Haversine et les logiques de corrélation GPS
 * précédemment dupliquées dans SafetyService et PublicReporterService.
 *
 * Principe SOLID :
 *   - Single Responsibility : uniquement la géo-sécurité.
 *   - Dependency Inversion : dépend de PrismaService et TenantConfigService
 *     (interfaces stables), pas d'implémentations concrètes externes.
 *
 * Zéro magic-number : toutes les constantes métier viennent de TenantConfig
 * (avec DEFAULT_CONFIG comme fallback défini dans TenantConfigService).
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantConfigService } from './tenant-config.service';

// ─── Contrats publics ──────────────────────────────────────────────────────────

export interface GeoCorrelationResult {
  correlatedBusId?:  string;
  verificationScore: number;  // [0..1], arrondi à 2 décimales
}

// ─── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class GeoSafetyProvider {
  constructor(
    private readonly prisma:  PrismaService,
    private readonly configs: TenantConfigService,
  ) {}

  // ─── API publique ─────────────────────────────────────────────────────────────

  /**
   * Calcule le score de corrélation GPS pour une alerte in-app (SafetyService).
   *
   * Compare la position actuelle du bus (Trip.currentLat/Lng) à la position
   * du déclarant. Score linéaire : 1.0 si distance = 0, 0 si distance ≥ proximityThresholdKm.
   *
   * @returns score [0..1]
   */
  async computeTripGeoScore(
    tenantId:    string,
    tripId:      string,
    reporterLat: number,
    reporterLng: number,
  ): Promise<number> {
    const config = await this.configs.getConfig(tenantId);

    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { currentLat: true, currentLng: true },
    });

    if (!trip?.currentLat || !trip?.currentLng) return 0;

    const dist = this.haversineKm(reporterLat, reporterLng, trip.currentLat, trip.currentLng);
    // Score linéaire : 1.0 à distance 0, 0 à proximityThresholdKm
    return this.clampScore(1 - dist / config.proximityThresholdKm);
  }

  /**
   * Corrèle un signalement citoyen avec un bus identifié par immatriculation
   * ou numéro de parc (PublicReporterService).
   *
   * Logique :
   *   1. Bus introuvable → score 0.
   *   2. Bus trouvé, pas de GPS reporter → score 0.3 (identifié sans position).
   *   3. Bus trouvé, GPS disponible → score haversine vs position bus actuelle.
   *      Score linéaire : 1.0 à 0m, 0 à publicProximityKm.
   *
   * @returns { correlatedBusId?, verificationScore }
   */
  async correlateByPlate(
    tenantId: string,
    plate:    string,
    lat?:     number,
    lng?:     number,
  ): Promise<GeoCorrelationResult> {
    const config = await this.configs.getConfig(tenantId);

    const bus = await this.prisma.bus.findFirst({
      where:  { tenantId, plateNumber: plate },
      select: { id: true },
    });

    if (!bus) return { verificationScore: 0 };

    if (!lat || !lng) {
      return { correlatedBusId: bus.id, verificationScore: 0.3 };
    }

    const trip = await this.prisma.trip.findFirst({
      where:   { tenantId, busId: bus.id, status: { in: ['BOARDING', 'IN_PROGRESS'] } },
      orderBy: { departureScheduled: 'desc' },
      select:  { currentLat: true, currentLng: true },
    });

    if (!trip?.currentLat || !trip?.currentLng) {
      return { correlatedBusId: bus.id, verificationScore: 0.3 };
    }

    const dist  = this.haversineKm(lat, lng, trip.currentLat, trip.currentLng);
    const score = this.clampScore(1 - dist / config.publicProximityKm);

    return { correlatedBusId: bus.id, verificationScore: score };
  }

  /**
   * Calcul de distance géodésique (formule de Haversine).
   * Exposé publiquement pour les consumers qui ont déjà les coordonnées.
   * @returns distance en kilomètres
   */
  haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R    = 6_371; // rayon moyen de la Terre (km)
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── Helpers privés ───────────────────────────────────────────────────────────

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  /** Clamp [0..1] arrondi à 2 décimales. */
  private clampScore(raw: number): number {
    return Math.round(Math.max(0, Math.min(1, raw)) * 100) / 100;
  }
}
