import { Injectable, Inject } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, IsNumber } from 'class-validator';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IEventBus, EVENT_BUS, DomainEvent } from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { GeoSafetyProvider } from '../../core/security/geo-safety.provider';
import { TenantConfigService } from '../../core/security/tenant-config.service';
import { v4 as uuidv4 } from 'uuid';

// ─── DTO ──────────────────────────────────────────────────────────────────────

export class PublicReportDto {
  @IsString()
  plateOrParkNumber: string;

  @IsEnum(['DANGEROUS_DRIVING', 'ACCIDENT', 'BREAKDOWN', 'OTHER'])
  type: 'DANGEROUS_DRIVING' | 'ACCIDENT' | 'BREAKDOWN' | 'OTHER';

  @IsString()
  description: string;

  @IsNumber()
  @IsOptional()
  reporterGpsLat?: number;

  @IsNumber()
  @IsOptional()
  reporterGpsLng?: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PublicReporterService {
  /** RGPD : les coordonnées GPS citoyens expirent après 24h (cron séparé). */
  private static readonly GPS_TTL_MS = 24 * 3_600_000;

  constructor(
    private readonly prisma:   PrismaService,
    private readonly geo:      GeoSafetyProvider,
    private readonly configs:  TenantConfigService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Signalement citoyen — pas d'auth requise.
   * Délègue la corrélation géo à GeoSafetyProvider.
   * Le seuil d'auto-vérification vient de TenantConfig (sans magic-number).
   */
  async submit(tenantId: string, dto: PublicReportDto, reporterIp: string) {
    const config = await this.configs.getConfig(tenantId);

    const { correlatedBusId, verificationScore } = await this.geo.correlateByPlate(
      tenantId,
      dto.plateOrParkNumber,
      dto.reporterGpsLat,
      dto.reporterGpsLng,
    );

    const isVerified = verificationScore >= config.autoVerifyScoreThreshold;

    const report = await this.prisma.transact(async (tx) => {
      const r = await tx.publicReport.create({
        data: {
          tenantId,
          plateOrParkNumber:   dto.plateOrParkNumber,
          type:                dto.type,
          description:         dto.description,
          reporterGpsLat:      dto.reporterGpsLat,
          reporterGpsLng:      dto.reporterGpsLng,
          reporterGpsExpireAt: new Date(Date.now() + PublicReporterService.GPS_TTL_MS),
          verificationScore,
          status:              isVerified ? 'VERIFIED' : 'PENDING',
          correlatedBusId,
          reporterIp,
        },
      });

      if (isVerified) {
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

  /**
   * Liste pour les opérateurs de dispatch.
   * GPS exclus de la réponse (RGPD — accès restreint aux opérateurs via endpoint séparé).
   */
  async listForDispatch(tenantId: string, status?: string) {
    return this.prisma.publicReport.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take:    100,
      select: {
        id: true, plateOrParkNumber: true, type: true,
        description: true, verificationScore: true, status: true,
        correlatedBusId: true, createdAt: true,
        // reporterGpsLat / reporterGpsLng intentionnellement exclus (RGPD)
      },
    });
  }
}
