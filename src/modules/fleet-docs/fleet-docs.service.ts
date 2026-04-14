/**
 * FleetDocsService — Gestion des documents réglementaires véhicules
 * et suivi des consommables avec alertes prédictives.
 *
 * Responsabilités :
 *   - CRUD des VehicleDocument (assurance, CT, carte grise…)
 *   - Calcul du statut de validité (VALID | EXPIRING | EXPIRED | MISSING)
 *   - Suivi des ConsumableTracking (pneus, vidange, filtres…)
 *   - Publication d'événements fleet.document.expiring / fleet.consumable.alert_due
 *
 * Règle d'or : aucun magic number — tous les seuils viennent de VehicleDocumentType
 * et ConsumableType chargés depuis la DB (data-driven per tenant).
 */

import {
  Injectable,
  NotFoundException,
  Inject,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  IStorageService,
  STORAGE_SERVICE,
  DocumentType,
} from '../../infrastructure/storage/interfaces/storage.interface';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateVehicleDocumentDto {
  busId:       string;
  typeId:      string;
  referenceNo?: string;
  issuedAt?:   string;   // ISO date
  expiresAt?:  string;   // ISO date
  notes?:      string;
}

export interface UpdateVehicleDocumentDto {
  referenceNo?: string;
  issuedAt?:    string;
  expiresAt?:   string;
  notes?:       string;
}

export interface UpdateConsumableKmDto {
  busId:  string;
  typeId: string;
  currentKm: number;
}

export interface RecordConsumableReplacementDto {
  busId:           string;
  typeId:          string;
  replacedAtKm:    number;
  reportId?:       string;  // MaintenanceReport associé
}

// ─── Valeurs de statut (pas d'enum — strings libres comparables) ──────────────

const DOC_STATUS = {
  VALID:    'VALID',
  EXPIRING: 'EXPIRING',
  EXPIRED:  'EXPIRED',
  MISSING:  'MISSING',
} as const;

const CONSUMABLE_STATUS = {
  OK:      'OK',
  ALERT:   'ALERT',
  OVERDUE: 'OVERDUE',
} as const;

@Injectable()
export class FleetDocsService {
  private readonly logger = new Logger(FleetDocsService.name);

  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ─── Document Types ───────────────────────────────────────────────────────

  async createDocumentType(tenantId: string, dto: {
    name: string; code: string; alertDaysBeforeExpiry?: number; isMandatory?: boolean;
  }) {
    return this.prisma.vehicleDocumentType.create({
      data: {
        tenantId,
        name:                 dto.name,
        code:                 dto.code.toUpperCase(),
        alertDaysBeforeExpiry: dto.alertDaysBeforeExpiry ?? 30,
        isMandatory:          dto.isMandatory ?? true,
      },
    });
  }

  async listDocumentTypes(tenantId: string) {
    return this.prisma.vehicleDocumentType.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Vehicle Documents ────────────────────────────────────────────────────

  async createDocument(tenantId: string, dto: CreateVehicleDocumentDto, actorId: string) {
    const [bus, type] = await Promise.all([
      this.prisma.bus.findFirst({ where: { id: dto.busId, tenantId } }),
      this.prisma.vehicleDocumentType.findFirst({ where: { id: dto.typeId, tenantId } }),
    ]);
    if (!bus)  throw new NotFoundException(`Bus ${dto.busId} introuvable`);
    if (!type) throw new NotFoundException(`Type de document ${dto.typeId} introuvable`);

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    const status    = this._computeDocStatus(expiresAt, type.alertDaysBeforeExpiry);

    return this.prisma.vehicleDocument.create({
      data: {
        tenantId,
        busId:       dto.busId,
        typeId:      dto.typeId,
        referenceNo: dto.referenceNo,
        issuedAt:    dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt,
        status,
        notes:       dto.notes,
        uploadedById: actorId,
      },
    });
  }

  async updateDocument(tenantId: string, id: string, dto: UpdateVehicleDocumentDto) {
    const doc = await this.prisma.vehicleDocument.findFirst({
      where:   { id, tenantId },
      include: { type: true },
    });
    if (!doc) throw new NotFoundException(`Document ${id} introuvable`);

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : doc.expiresAt ?? undefined;
    const status    = this._computeDocStatus(expiresAt, doc.type.alertDaysBeforeExpiry);

    return this.prisma.vehicleDocument.update({
      where: { id },
      data: {
        referenceNo: dto.referenceNo,
        issuedAt:    dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt:   expiresAt ?? null,
        status,
        notes:       dto.notes,
      },
    });
  }

  async getUploadUrl(tenantId: string, documentId: string) {
    const doc = await this.prisma.vehicleDocument.findFirst({ where: { id: documentId, tenantId } });
    if (!doc) throw new NotFoundException(`Document ${documentId} introuvable`);

    const key = `${tenantId}/fleet/docs/${doc.busId}/${documentId}-${Date.now()}.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.vehicleDocument.update({ where: { id: documentId }, data: { fileKey: key } });
    return { uploadUrl: url, fileKey: key };
  }

  async getDocumentsForBus(tenantId: string, busId: string) {
    return this.prisma.vehicleDocument.findMany({
      where:   { tenantId, busId },
      include: { type: true },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async getMissingOrExpiredDocuments(tenantId: string) {
    return this.prisma.vehicleDocument.findMany({
      where:   { tenantId, status: { in: [DOC_STATUS.EXPIRED, DOC_STATUS.MISSING, DOC_STATUS.EXPIRING] } },
      include: { type: true, bus: { select: { id: true, plateNumber: true, model: true } } },
      orderBy: { expiresAt: 'asc' },
    });
  }

  // ─── Consumable Types ─────────────────────────────────────────────────────

  async createConsumableType(tenantId: string, dto: {
    name: string; code: string; nominalLifetimeKm: number; alertKmBefore: number;
  }) {
    return this.prisma.consumableType.create({
      data: {
        tenantId,
        name:              dto.name,
        code:              dto.code.toUpperCase(),
        nominalLifetimeKm: dto.nominalLifetimeKm,
        alertKmBefore:     dto.alertKmBefore,
      },
    });
  }

  async listConsumableTypes(tenantId: string) {
    return this.prisma.consumableType.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Consumable Tracking ──────────────────────────────────────────────────

  /**
   * Met à jour le kilométrage courant d'un bus sur tous ses consommables.
   * Appelé à chaque mise à jour GPS significative (depuis TrackingService
   * ou à la clôture d'un trajet).
   */
  async syncBusOdometer(tenantId: string, busId: string, currentKm: number) {
    const trackings = await this.prisma.consumableTracking.findMany({
      where:   { tenantId, busId },
      include: { type: true },
    });

    for (const tracking of trackings) {
      const status = this._computeConsumableStatus(
        currentKm,
        tracking.lastReplacedKm,
        tracking.type.nominalLifetimeKm,
        tracking.type.alertKmBefore,
      );
      const nextDueKm = tracking.lastReplacedKm != null
        ? tracking.lastReplacedKm + tracking.type.nominalLifetimeKm
        : null;

      const updated = await this.prisma.consumableTracking.update({
        where: { id: tracking.id },
        data:  { currentKm, status, nextDueKm: nextDueKm ?? undefined },
      });

      // Publier un événement si l'état a changé vers ALERT ou OVERDUE
      if (updated.status !== tracking.status && updated.status !== CONSUMABLE_STATUS.OK) {
        await this._publishConsumableAlert(tenantId, busId, tracking.type.code, updated.status, nextDueKm ?? 0);
      }
    }
  }

  async recordConsumableReplacement(tenantId: string, dto: RecordConsumableReplacementDto) {
    const type = await this.prisma.consumableType.findFirst({
      where: { tenantId, id: dto.typeId },
    });
    if (!type) throw new NotFoundException(`Consommable ${dto.typeId} introuvable`);

    const nextDueKm = dto.replacedAtKm + type.nominalLifetimeKm;

    return this.prisma.consumableTracking.upsert({
      where:  { busId_typeId: { busId: dto.busId, typeId: dto.typeId } },
      create: {
        tenantId,
        busId:          dto.busId,
        typeId:         dto.typeId,
        lastReplacedKm: dto.replacedAtKm,
        lastReplacedAt: new Date(),
        currentKm:      dto.replacedAtKm,
        status:         CONSUMABLE_STATUS.OK,
        nextDueKm,
      },
      update: {
        lastReplacedKm: dto.replacedAtKm,
        lastReplacedAt: new Date(),
        currentKm:      dto.replacedAtKm,
        status:         CONSUMABLE_STATUS.OK,
        nextDueKm,
      },
    });
  }

  async getConsumablesForBus(tenantId: string, busId: string) {
    return this.prisma.consumableTracking.findMany({
      where:   { tenantId, busId },
      include: { type: true },
      orderBy: { status: 'asc' },
    });
  }

  // ─── Maintenance Intervenants & Parts ─────────────────────────────────────

  async addIntervenant(tenantId: string, reportId: string, dto: {
    staffId?: string; externalName?: string; role: string; hoursWorked?: number; notes?: string;
  }) {
    return this.prisma.maintenanceIntervenant.create({
      data: { tenantId, reportId, ...dto },
    });
  }

  async addPart(tenantId: string, reportId: string, dto: {
    consumableTypeId?: string; partName: string; partReference?: string;
    quantity?: number; unitCostXaf?: number; kmAtReplacement?: number;
  }) {
    return this.prisma.maintenancePart.create({
      data: { tenantId, reportId, quantity: 1, ...dto },
    });
  }

  async getMaintenanceDetail(tenantId: string, reportId: string) {
    return this.prisma.maintenanceReport.findFirst({
      where:   { id: reportId, tenantId },
      include: {
        intervenants: true,
        parts:        { include: { /* consumable type joined below via prisma generate */ } },
        bus:          { select: { id: true, plateNumber: true, model: true } },
      },
    });
  }

  // ─── Scheduler: recompute document statuses daily ────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async refreshDocumentStatuses(): Promise<void> {
    this.logger.log('Refreshing vehicle document statuses…');

    const docs = await this.prisma.vehicleDocument.findMany({
      include: { type: true },
    });

    let updated = 0;
    for (const doc of docs) {
      const newStatus = this._computeDocStatus(doc.expiresAt ?? undefined, doc.type.alertDaysBeforeExpiry);
      if (newStatus !== doc.status) {
        await this.prisma.vehicleDocument.update({
          where: { id: doc.id },
          data:  { status: newStatus },
        });
        if (newStatus === DOC_STATUS.EXPIRING || newStatus === DOC_STATUS.EXPIRED) {
          await this._publishDocumentAlert(doc.tenantId, doc.busId, doc.type.code, newStatus, doc.expiresAt);
        }
        updated++;
      }
    }
    this.logger.log(`Document statuses refreshed: ${updated} changes`);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private _computeDocStatus(
    expiresAt: Date | undefined,
    alertDaysBeforeExpiry: number,
  ): string {
    if (!expiresAt) return DOC_STATUS.MISSING;
    const now        = new Date();
    const alertLimit = new Date(expiresAt.getTime() - alertDaysBeforeExpiry * 24 * 60 * 60 * 1000);
    if (now > expiresAt)   return DOC_STATUS.EXPIRED;
    if (now >= alertLimit) return DOC_STATUS.EXPIRING;
    return DOC_STATUS.VALID;
  }

  private _computeConsumableStatus(
    currentKm:        number,
    lastReplacedKm:   number | null,
    nominalLifetimeKm: number,
    alertKmBefore:    number,
  ): string {
    if (lastReplacedKm === null) return CONSUMABLE_STATUS.ALERT; // jamais remplacé = alert
    const nextDueKm   = lastReplacedKm + nominalLifetimeKm;
    const alertAtKm   = nextDueKm - alertKmBefore;
    if (currentKm >= nextDueKm)  return CONSUMABLE_STATUS.OVERDUE;
    if (currentKm >= alertAtKm)  return CONSUMABLE_STATUS.ALERT;
    return CONSUMABLE_STATUS.OK;
  }

  private async _publishDocumentAlert(
    tenantId: string,
    busId:    string,
    typeCode: string,
    status:   string,
    expiresAt: Date | null,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          EventTypes.FLEET_DOCUMENT_ALERT,
      tenantId,
      aggregateId:   busId,
      aggregateType: 'Bus',
      payload:       { busId, documentTypeCode: typeCode, status, expiresAt },
      occurredAt:    new Date(),
    };
    // publish sans transaction (événement de monitoring, pas métier critique)
    await this.eventBus.publish(event, null);
  }

  private async _publishConsumableAlert(
    tenantId:      string,
    busId:         string,
    consumableCode: string,
    status:        string,
    nextDueKm:     number,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type:          EventTypes.FLEET_CONSUMABLE_ALERT,
      tenantId,
      aggregateId:   busId,
      aggregateType: 'Bus',
      payload:       { busId, consumableCode, status, nextDueKm },
      occurredAt:    new Date(),
    };
    await this.eventBus.publish(event, null);
  }
}
