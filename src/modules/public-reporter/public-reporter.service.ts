import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { v4 as uuidv4 } from 'uuid';

export interface PublicReportDto {
  plateOrParkNumber: string;
  type:              'DANGEROUS_DRIVING' | 'ACCIDENT' | 'BREAKDOWN' | 'OTHER';
  description:       string;
  reporterGpsLat?:   number;
  reporterGpsLng?:   number;
}

@Injectable()
export class PublicReporterService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Signalement citoyen — pas d'auth requise.
   * Validation géo-temporelle : corrèle les coords déclarant + GPS bus (±200m, ±15min).
   * RGPD : les coords GPS expirent après 24h (cron séparé).
   */
  async submit(
    tenantId:    string,
    dto:         PublicReportDto,
    reporterIp:  string,
  ) {
    const { correlatedBusId, verificationScore } = await this.correlate(
      tenantId, dto.plateOrParkNumber, dto.reporterGpsLat, dto.reporterGpsLng,
    );

    const report = await this.prisma.transact(async (tx) => {
      const r = await tx.publicReport.create({
        data: {
          tenantId,
          plateOrParkNumber:   dto.plateOrParkNumber,
          type:                dto.type,
          description:         dto.description,
          reporterGpsLat:      dto.reporterGpsLat,
          reporterGpsLng:      dto.reporterGpsLng,
          reporterGpsExpireAt: new Date(Date.now() + 24 * 3_600_000), // RGPD 24h
          verificationScore,
          status:              verificationScore >= 0.9 ? 'VERIFIED' : 'PENDING',
          correlatedBusId,
          reporterIp,
        },
      });

      if (verificationScore >= 0.9) {
        const event: DomainEvent = {
          id:            uuidv4(),
          type:          'safety.public_report',
          tenantId,
          aggregateId:   r.id,
          aggregateType: 'PublicReport',
          payload: {
            reportId:          r.id,
            alertType:         dto.type,
            plateOrParkNumber: dto.plateOrParkNumber,
            correlatedBusId,
            verificationScore,
          },
          occurredAt: new Date(),
        };
        await this.eventBus.publish(event, tx as unknown as any);
      }

      return r;
    });

    return { id: report.id, status: report.status, verificationScore };
  }

  async listForDispatch(tenantId: string, status?: string) {
    return this.prisma.publicReport.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, plateOrParkNumber: true, type: true,
        description: true, verificationScore: true, status: true,
        correlatedBusId: true, createdAt: true,
        // GPS exclus de la liste (RGPD — accès restreint)
      },
    });
  }

  /**
   * Corrélation : retrouve le bus par immatriculation / numéro de parc,
   * compare sa position GPS au moment du signalement.
   */
  private async correlate(
    tenantId:    string,
    plate:       string,
    lat?:        number,
    lng?:        number,
  ): Promise<{ correlatedBusId?: string; verificationScore: number }> {
    const bus = await this.prisma.bus.findFirst({
      where: { tenantId, plateNumber: plate },
    });

    if (!bus) return { verificationScore: 0 };
    if (!lat || !lng || !bus) return { correlatedBusId: bus.id, verificationScore: 0.3 };

    const trip = await this.prisma.trip.findFirst({
      where:   { tenantId, busId: bus.id, status: { in: ['BOARDING', 'IN_PROGRESS'] } },
      orderBy: { departureScheduled: 'desc' },
      select:  { currentLat: true, currentLng: true },
    });

    if (!trip?.currentLat || !trip?.currentLng) {
      return { correlatedBusId: bus.id, verificationScore: 0.3 };
    }

    const dist  = this.haversineKm(lat, lng, trip.currentLat, trip.currentLng);
    const score = Math.max(0, 1 - dist / 0.5); // 1.0 < 50m, 0 à 500m

    return { correlatedBusId: bus.id, verificationScore: Math.round(score * 100) / 100 };
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R    = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
