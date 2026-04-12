import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { v4 as uuidv4 } from 'uuid';

export interface ReportAlertDto {
  type:         'DANGEROUS_DRIVING' | 'ACCIDENT' | 'BREAKDOWN' | 'OTHER';
  tripId?:      string;
  description?: string;
  gpsLat?:      number;
  gpsLng?:      number;
}

@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Signalement depuis l'app (voyageur ou chauffeur).
   * Vérifie la corrélation GPS bus/déclarant si les deux coords sont disponibles.
   * Publie un événement prioritaire via Outbox pour le Dispatch.
   */
  async reportAlert(tenantId: string, dto: ReportAlertDto, actor: CurrentUserPayload) {
    let verificationScore = 0;

    if (dto.tripId && dto.gpsLat && dto.gpsLng) {
      verificationScore = await this.computeGeoScore(tenantId, dto.tripId, dto.gpsLat, dto.gpsLng);
    }

    return this.prisma.transact(async (tx) => {
      const alert = await tx.safetyAlert.create({
        data: {
          tenantId,
          tripId:            dto.tripId,
          reporterId:        actor.id,
          type:              dto.type,
          description:       dto.description,
          gpsLat:            dto.gpsLat,
          gpsLng:            dto.gpsLng,
          verificationScore,
          status:            verificationScore >= 0.9 ? 'VERIFIED' : 'PENDING',
          source:            'IN_APP',
        },
      });

      const event: DomainEvent = {
        id:            uuidv4(),
        type:          'safety.alert',
        tenantId,
        aggregateId:   alert.id,
        aggregateType: 'SafetyAlert',
        payload: {
          alertId:           alert.id,
          alertType:         dto.type,
          tripId:            dto.tripId,
          verificationScore,
          verified:          alert.status === 'VERIFIED',
          reporterId:        actor.id,
        },
        occurredAt: new Date(),
      };

      await this.eventBus.publish(event, tx as unknown as any);
      return alert;
    });
  }

  async listAlerts(tenantId: string, status?: string) {
    return this.prisma.safetyAlert.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    100,
    });
  }

  async dismiss(tenantId: string, alertId: string) {
    return this.prisma.safetyAlert.update({
      where: { id: alertId },
      data:  { status: 'DISMISSED' },
    });
  }

  /**
   * Corrélation GPS : compare la position du bus au moment du signalement
   * avec les coords du déclarant. Score [0..1].
   */
  private async computeGeoScore(
    tenantId: string,
    tripId:   string,
    lat:      number,
    lng:      number,
  ): Promise<number> {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { currentLat: true, currentLng: true },
    });

    if (!trip?.currentLat || !trip?.currentLng) return 0;

    const dist = this.haversineKm(lat, lng, trip.currentLat, trip.currentLng);
    // Score 1.0 si < 0.5km, dégressif jusqu'à 0 à 5km
    return Math.max(0, 1 - dist / 5);
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R  = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
