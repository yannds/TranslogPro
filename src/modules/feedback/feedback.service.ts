import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

export interface SubmitFeedbackDto {
  tripId?:       string;
  driverId?:     string;
  busId?:        string;
  agencyId?:     string;
  ratings: {
    conduct?:      number; // 0-5
    punctuality?:  number;
    comfort?:      number;
    baggage?:      number;
  };
  comment?:      string;
  rgpdConsent:   boolean; // obligatoire
}

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(tenantId: string, dto: SubmitFeedbackDto, actor: CurrentUserPayload) {
    if (!dto.rgpdConsent) {
      throw new Error('Consentement RGPD requis pour soumettre un avis');
    }

    const feedback = await this.prisma.feedback.create({
      data: {
        tenantId,
        userId:       actor.id,
        tripId:       dto.tripId,
        driverId:     dto.driverId,
        busId:        dto.busId,
        agencyId:     dto.agencyId,
        ratings:      dto.ratings,
        comment:      dto.comment,
        rgpdConsentAt: new Date(),
      },
    });

    // Mise à jour asynchrone des agrégats Rating (fire & forget — non critique)
    this.updateRatings(tenantId, dto).catch(() => {});

    return feedback;
  }

  async getForTrip(tenantId: string, tripId: string) {
    return this.prisma.feedback.findMany({
      where:   { tenantId, tripId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRating(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.rating.findUnique({
      where: { tenantId_entityType_entityId: { tenantId, entityType, entityId } },
    });
  }

  async getRatingsForEntity(tenantId: string, entityType: string, entityId: string) {
    return this.prisma.feedback.findMany({
      where:   { tenantId, ...(entityType === 'DRIVER' ? { driverId: entityId } : { busId: entityId }) },
      select:  { ratings: true, comment: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    50,
    });
  }

  private async updateRatings(tenantId: string, dto: SubmitFeedbackDto) {
    const entities: Array<{ type: string; id: string; score: number }> = [];
    const r = dto.ratings;

    if (dto.driverId && r.conduct !== undefined) {
      const score = ((r.conduct ?? 0) + (r.punctuality ?? 0)) / 2;
      entities.push({ type: 'DRIVER', id: dto.driverId, score });
    }
    if (dto.busId && r.comfort !== undefined) {
      entities.push({ type: 'BUS', id: dto.busId, score: r.comfort });
    }
    if (dto.agencyId && r.baggage !== undefined) {
      entities.push({ type: 'AGENCY', id: dto.agencyId, score: r.baggage });
    }

    for (const e of entities) {
      const existing = await this.prisma.rating.findUnique({
        where: { tenantId_entityType_entityId: { tenantId, entityType: e.type, entityId: e.id } },
      });

      if (existing) {
        const newCount = existing.count + 1;
        const newAvg   = (existing.avgScore * existing.count + e.score) / newCount;
        await this.prisma.rating.update({
          where: { tenantId_entityType_entityId: { tenantId, entityType: e.type, entityId: e.id } },
          data:  { avgScore: newAvg, count: newCount },
        });
      } else {
        await this.prisma.rating.create({
          data: { tenantId, entityType: e.type, entityId: e.id, avgScore: e.score, count: 1 },
        });
      }
    }
  }
}
