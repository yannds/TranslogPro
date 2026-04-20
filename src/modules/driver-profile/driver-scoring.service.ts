import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * DriverScoringService (Sprint 9) — calcul du score conducteur.
 *
 * Score = somme pondérée normalisée [0..1] × 100 :
 *   - Ponctualité : % trips où departureActual ≤ scheduledDeparture + grâce
 *   - Incidents   : 1 - (nb incidents / max(1, trips)) borné [0..1]
 *   - Volume      : min(1, trips / targetTripsPerWindow) — reconnaît activité soutenue
 *
 * Poids configurables par tenant (TenantBusinessConfig.driverScoreWeight*).
 * Fenêtre glissante configurable (driverScoreWindowDays).
 *
 * Le service est volontairement simple et auditable — le résultat est
 * recalculable à tout moment depuis les événements bruts (trips + incidents).
 */

export interface DriverScoreResult {
  staffId:          string;
  overallScore:     number; // 0..100
  punctualityScore: number; // 0..1
  incidentScore:    number; // 0..1 (1 = aucun incident, 0 = beaucoup)
  tripVolumeScore:  number; // 0..1
  tripsCompleted:   number;
  tripsOnTime:      number;
  incidents:        number;
  windowStart:      Date;
  windowEnd:        Date;
}

const DEFAULT_TARGET_TRIPS_PER_WINDOW = 20;

@Injectable()
export class DriverScoringService {
  private readonly logger = new Logger(DriverScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcule et persiste le score d'un driver.
   * Pur : ne modifie rien d'autre que la table DriverScore.
   */
  async recomputeForDriver(tenantId: string, staffId: string): Promise<DriverScoreResult> {
    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where: { tenantId },
      select: {
        driverScoreWeightPunctuality: true,
        driverScoreWeightIncidents:   true,
        driverScoreWeightTripVolume:  true,
        driverScoreGraceMinutes:      true,
        driverScoreWindowDays:        true,
      },
    });

    const wPunct = config?.driverScoreWeightPunctuality ?? 0.5;
    const wIncid = config?.driverScoreWeightIncidents   ?? 0.3;
    const wVol   = config?.driverScoreWeightTripVolume  ?? 0.2;
    const grace  = config?.driverScoreGraceMinutes      ?? 10;
    const windowDays = config?.driverScoreWindowDays    ?? 30;

    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() - windowDays);

    // 1. Trips completed dans la fenêtre
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId, driverId: staffId,
        status: 'COMPLETED',
        departureScheduled: { gte: windowStart, lte: now },
      },
      select: { id: true, departureScheduled: true, departureActual: true },
    });

    // 2. Incidents liés aux trips du driver dans la fenêtre
    const tripIds = trips.map(t => t.id);
    const incidents = tripIds.length > 0
      ? await this.prisma.incident.count({
          where: { tenantId, tripId: { in: tripIds } },
        })
      : 0;

    // 3. Composantes
    const tripsCompleted = trips.length;
    const tripsOnTime = trips.filter(t => {
      if (!t.departureActual) return false;
      const delayMin = (t.departureActual.getTime() - t.departureScheduled.getTime()) / 60_000;
      return delayMin <= grace;
    }).length;

    const punctualityScore = tripsCompleted > 0 ? tripsOnTime / tripsCompleted : 0;
    const incidentScore    = tripsCompleted > 0
      ? Math.max(0, 1 - incidents / tripsCompleted)
      : 1; // pas de trip = neutre bienveillant (évite pénalisation driver inactif)
    const tripVolumeScore  = Math.min(1, tripsCompleted / DEFAULT_TARGET_TRIPS_PER_WINDOW);

    // Normalisation poids (au cas où ils ne somment pas à 1)
    const wSum = Math.max(0.0001, wPunct + wIncid + wVol);
    const overallFraction =
      (punctualityScore * wPunct + incidentScore * wIncid + tripVolumeScore * wVol) / wSum;
    const overallScore = Math.round(overallFraction * 100 * 100) / 100; // 2 décimales

    const result: DriverScoreResult = {
      staffId, overallScore,
      punctualityScore, incidentScore, tripVolumeScore,
      tripsCompleted, tripsOnTime, incidents,
      windowStart, windowEnd: now,
    };

    // Persist
    await this.prisma.driverScore.upsert({
      where:  { staffId },
      update: {
        tenantId,
        punctualityScore, incidentScore, tripVolumeScore, overallScore,
        tripsCompleted, tripsOnTime, incidents,
        windowStart, windowEnd: now,
      },
      create: {
        tenantId, staffId,
        punctualityScore, incidentScore, tripVolumeScore, overallScore,
        tripsCompleted, tripsOnTime, incidents,
        windowStart, windowEnd: now,
      },
    });

    return result;
  }

  /** Recalcul batch tenant — utilisé par cron nocturne ou admin manuel. */
  async recomputeForTenant(tenantId: string): Promise<number> {
    const recentDriverIds = await this.prisma.trip.findMany({
      where:    { tenantId, status: 'COMPLETED' },
      select:   { driverId: true },
      distinct: ['driverId'],
      take:     500,
    });

    let count = 0;
    for (const row of recentDriverIds) {
      if (row.driverId) {
        try {
          await this.recomputeForDriver(tenantId, row.driverId);
          count++;
        } catch (err) {
          this.logger.warn(`[DriverScoring] failed for ${row.driverId}: ${(err as Error).message}`);
        }
      }
    }
    return count;
  }

  /** Leaderboard — scores déjà persistés, tri descendant, limité. */
  async leaderboard(tenantId: string, limit = 20) {
    return this.prisma.driverScore.findMany({
      where:   { tenantId },
      orderBy: { overallScore: 'desc' },
      take:    limit,
      include: {
        staff: {
          select: {
            id: true, status: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
  }
}
