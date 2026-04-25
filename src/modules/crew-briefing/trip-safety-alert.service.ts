/**
 * TripSafetyAlertService — alertes sécurité immuables attachées à un trip.
 *
 * Émises par :
 *   - CrewBriefingService v2 lors d'un item mandatory KO ou d'un shortfall
 *     de repos conducteur (selon politiques tenant).
 *   - D'autres sources ultérieurement (incidents, non-conformité QHSE…).
 *
 * Principes :
 *   - Immuable côté écriture : pas d'update du corps. Seuls `resolvedAt`,
 *     `resolvedById`, `resolutionNote` sont modifiables (clôture).
 *   - Fait foi en cas d'accident : l'audit trace le `createdAt`.
 *   - Publie des événements domain pour consommateurs (notifications managers,
 *     feed QHSE temps réel).
 */

import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 }   from 'uuid';
import { PrismaService }  from '../../infrastructure/database/prisma.service';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';

export type SafetyAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type SafetyAlertSource   = 'BRIEFING' | 'INCIDENT' | 'COMPLIANCE';

export interface RaiseAlertDto {
  tripId:       string;
  severity:     SafetyAlertSeverity;
  source:       SafetyAlertSource;
  code:         string; // ex: MANDATORY_EQUIPMENT_MISSING, DRIVER_REST_SHORTFALL
  payload?:     Record<string, unknown>;
}

export interface ListAlertsFilter {
  tripId?:     string;
  severity?:   SafetyAlertSeverity;
  source?:     SafetyAlertSource;
  resolved?:   boolean; // true = only resolved, false = only unresolved, undefined = all
  limit?:      number;
}

@Injectable()
export class TripSafetyAlertService {
  private readonly logger = new Logger(TripSafetyAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  /**
   * Émet une alerte sécurité. Immuable hors clôture.
   * Multi-émission autorisée : un même trip peut cumuler plusieurs alertes
   * (ex: deux items KO distincts → deux alertes avec codes différents).
   */
  async raise(tenantId: string, dto: RaiseAlertDto) {
    const trip = await this.prisma.trip.findFirst({
      where:  { id: dto.tripId, tenantId },
      select: { id: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${dto.tripId} introuvable pour ce tenant`);

    const alert = await this.prisma.tripSafetyAlert.create({
      data: {
        tenantId,
        tripId:   dto.tripId,
        severity: dto.severity,
        source:   dto.source,
        code:     dto.code,
        payload:  (dto.payload ?? {}) as object,
      },
    });

    await this._publish(tenantId, EventTypes.TRIP_SAFETY_ALERT_RAISED, alert.id, {
      tripId:   dto.tripId,
      severity: dto.severity,
      source:   dto.source,
      code:     dto.code,
      payload:  dto.payload ?? {},
    });

    return alert;
  }

  async list(tenantId: string, filter: ListAlertsFilter = {}) {
    const where: Record<string, unknown> = { tenantId };
    if (filter.tripId)   where.tripId   = filter.tripId;
    if (filter.severity) where.severity = filter.severity;
    if (filter.source)   where.source   = filter.source;
    if (filter.resolved === true)  where.resolvedAt = { not: null };
    if (filter.resolved === false) where.resolvedAt = null;

    return this.prisma.tripSafetyAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    filter.limit ?? 100,
    });
  }

  async listOpenForTrip(tenantId: string, tripId: string) {
    return this.list(tenantId, { tripId, resolved: false });
  }

  /**
   * Clôture une alerte (résolution, classement sans suite, note QHSE).
   * L'alerte reste en base — seul le statut de résolution est mis à jour.
   */
  async resolve(
    tenantId:    string,
    alertId:     string,
    dto: { resolvedById: string; resolutionNote?: string },
  ) {
    const alert = await this.prisma.tripSafetyAlert.findFirst({
      where: { id: alertId, tenantId },
    });
    if (!alert) throw new NotFoundException(`Alerte ${alertId} introuvable`);
    if (alert.resolvedAt) {
      throw new BadRequestException('Cette alerte est déjà résolue');
    }

    const updated = await this.prisma.tripSafetyAlert.update({
      where: { id: alertId },
      data: {
        resolvedAt:     new Date(),
        resolvedById:   dto.resolvedById,
        resolutionNote: dto.resolutionNote ?? null,
      },
    });

    await this._publish(tenantId, EventTypes.TRIP_SAFETY_ALERT_RESOLVED, alertId, {
      tripId:         updated.tripId,
      resolvedById:   dto.resolvedById,
      resolutionNote: dto.resolutionNote ?? null,
      code:           updated.code,
    });

    return updated;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async _publish(
    tenantId: string,
    type:     string,
    alertId:  string,
    payload:  Record<string, unknown>,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type,
      tenantId,
      aggregateId:   alertId,
      aggregateType: 'TripSafetyAlert',
      payload:       { alertId, ...payload },
      occurredAt:    new Date(),
    };
    await this.prisma.transact(tx => this.eventBus.publish(event, tx));
  }
}
