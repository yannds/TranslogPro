import { Injectable, Inject } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsNumber, IsUUID } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { GeoSafetyProvider } from '../../core/security/geo-safety.provider';
import { TenantConfigService } from '../../core/security/tenant-config.service';
import { v4 as uuidv4 } from 'uuid';

// ─── DTO ──────────────────────────────────────────────────────────────────────

export enum AlertType {
  DANGEROUS_DRIVING = 'DANGEROUS_DRIVING',
  ACCIDENT          = 'ACCIDENT',
  BREAKDOWN         = 'BREAKDOWN',
  OTHER             = 'OTHER',
}

export class ReportAlertDto {
  @IsEnum(AlertType)
  type: AlertType;

  @IsUUID()
  @IsOptional()
  tripId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  gpsLat?: number;

  @IsNumber()
  @IsOptional()
  gpsLng?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SafetyService {
  constructor(
    private readonly prisma:   PrismaService,
    private readonly geo:      GeoSafetyProvider,
    private readonly configs:  TenantConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Signalement depuis l'app (voyageur ou chauffeur).
   * Délègue le calcul de corrélation GPS à GeoSafetyProvider.
   * Le seuil d'auto-vérification est lu depuis TenantConfig (sans magic-number).
   */
  async reportAlert(tenantId: string, dto: ReportAlertDto, actor: CurrentUserPayload) {
    const config = await this.configs.getConfig(tenantId);

    let verificationScore = 0;

    if (dto.tripId && dto.gpsLat != null && dto.gpsLng != null) {
      verificationScore = await this.geo.computeTripGeoScore(
        tenantId, dto.tripId, dto.gpsLat, dto.gpsLng,
      );
    }

    const isVerified = verificationScore >= config.autoVerifyScoreThreshold;

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
          status:            isVerified ? 'VERIFIED' : 'PENDING',
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
          verified:          isVerified,
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
}
