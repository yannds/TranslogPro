/**
 * DriverRestCalculatorService — calcul du temps de repos d'un chauffeur.
 *
 * Lit le dernier Trip terminé (status=COMPLETED ou arrivalActual non null)
 * du chauffeur et calcule le delta en heures depuis la fin du trajet.
 *
 * Seuil réglementaire : TenantBusinessConfig.minDriverRestHours (défaut 11h UE).
 *
 * Consommé par :
 *   - CrewBriefingService v2 (item auto-calculé DRIVER_REST_HOURS)
 *   - éventuels autres garde-fous (scheduler, dispatch)
 *
 * Règle métier :
 *   - Si aucun trajet terminé récent → on considère le repos comme conforme
 *     (Infinity), pour éviter de bloquer les premiers briefings.
 *   - Si dernier trajet terminé < minDriverRestHours → shortfall = true.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../infrastructure/database/prisma.service';

export interface DriverRestAssessment {
  driverId:            string;        // Staff.id du chauffeur
  lastTripEndedAt:     Date | null;   // null si aucun trajet précédent
  restHours:           number;        // Infinity si pas de trajet précédent
  thresholdHours:      number;        // Seuil tenant appliqué
  compliant:           boolean;       // restHours >= thresholdHours
  shortfallHours:      number;        // 0 si compliant, sinon (threshold - restHours)
}

@Injectable()
export class DriverRestCalculatorService {
  private readonly logger = new Logger(DriverRestCalculatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule l'évaluation de repos pour un chauffeur à un instant donné.
   *
   * @param tenantId  tenantId (sécurité multi-tenant)
   * @param driverId  Staff.id du chauffeur
   * @param now       instant de référence (défaut = new Date())
   *                  — utile pour tests ou calcul rétroactif lors d'un audit.
   */
  async assess(
    tenantId: string,
    driverId: string,
    now:      Date = new Date(),
  ): Promise<DriverRestAssessment> {
    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where:  { tenantId },
      select: { minDriverRestHours: true },
    });
    const thresholdHours = config?.minDriverRestHours ?? 11;

    // Dernier trajet terminé du chauffeur — on prend l'arrivée réelle si
    // disponible, sinon l'arrivée planifiée. On ne considère que les trajets
    // dont la fin est strictement antérieure à `now`.
    const lastTrip = await this.prisma.trip.findFirst({
      where: {
        tenantId,
        driverId,
        OR: [
          { arrivalActual:    { lt: now } },
          { status:           'COMPLETED', arrivalScheduled: { lt: now } },
        ],
      },
      orderBy: [{ arrivalActual: 'desc' }, { arrivalScheduled: 'desc' }],
      select: {
        id:               true,
        arrivalActual:    true,
        arrivalScheduled: true,
        status:           true,
      },
    });

    const lastEnd = lastTrip?.arrivalActual ?? lastTrip?.arrivalScheduled ?? null;

    if (!lastEnd) {
      return {
        driverId,
        lastTripEndedAt: null,
        restHours:       Number.POSITIVE_INFINITY,
        thresholdHours,
        compliant:       true,
        shortfallHours:  0,
      };
    }

    const restHours = (now.getTime() - lastEnd.getTime()) / 3_600_000;
    const compliant = restHours >= thresholdHours;

    return {
      driverId,
      lastTripEndedAt: lastEnd,
      restHours:       Number(restHours.toFixed(2)),
      thresholdHours,
      compliant,
      shortfallHours:  compliant ? 0 : Number((thresholdHours - restHours).toFixed(2)),
    };
  }
}
