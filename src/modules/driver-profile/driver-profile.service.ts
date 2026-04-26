/**
 * DriverProfileService — Dossier chauffeur, temps de repos réglementaires,
 * formations obligatoires et moteur de remédiation CRM.
 *
 * Responsabilités :
 *   - CRUD permis de conduire (DriverLicense) avec calcul de statut
 *   - Gestion des périodes de repos (DriverRestPeriod) — source AUTO|MANUAL|MEDICAL
 *   - Validation du respect des temps de repos avant affectation
 *   - Génération du planning de formations (DriverTraining) selon fréquence tenant
 *   - Moteur de remédiation : évaluation des DriverRemediationRule vs score CRM
 *
 * Règle d'or : tous les seuils (minRestMinutes, scoreBelowThreshold, frequencyDays)
 * viennent de la DB par tenant — jamais de magic numbers.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertOwnership } from '../../common/helpers/scope-filter';
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
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';

const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateDriverLicenseDto {
  staffId:      string;
  category:     string;        // "B", "D", "EC"…
  licenseNo:    string;
  issuedAt:     string;        // ISO date
  expiresAt:    string;        // ISO date
  issuingState?: string;
  /** Fichier scan du permis (optionnel — envoyé via multipart). */
  file?: { buffer: Buffer; originalname: string; mimetype: string; size: number };
}

export interface UpdateDriverLicenseDto {
  licenseNo?:    string;
  issuedAt?:     string;
  expiresAt?:    string;
  issuingState?: string;
  status?:       string;       // VALID | EXPIRING | EXPIRED | SUSPENDED
  /** Nouveau scan (optionnel — remplace le précédent). */
  file?: { buffer: Buffer; originalname: string; mimetype: string; size: number };
}

export interface StartRestPeriodDto {
  staffId:   string;
  startedAt: string;           // ISO datetime
  source:    string;           // AUTO | MANUAL | MEDICAL
  notes?:    string;
}

export interface EndRestPeriodDto {
  endedAt: string;             // ISO datetime
}

export interface CreateTrainingTypeDto {
  name:          string;
  code:          string;
  frequencyDays?: number;
  durationHours?: number;
  isMandatory?:  boolean;
}

export interface ScheduleTrainingDto {
  staffId:       string;
  typeId:        string;
  scheduledAt:   string;       // ISO date
  trainerName?:  string;
  locationName?: string;
  notes?:        string;
}

export interface CompleteTrainingDto {
  completedAt: string;         // ISO date
  trainerName?: string;
  notes?:       string;
}

export interface CreateRemediationRuleDto {
  name:                string;
  scoreBelowThreshold: number;
  actionType:          string;   // TRAINING | WARNING | SUSPENSION
  trainingTypeId?:     string;
  suspensionDays?:     number;
  priority?:           number;
}

// ─── Statuts (DB-driven labels, pas d'enum) ───────────────────────────────────

const LICENSE_STATUS = {
  VALID:     'VALID',
  EXPIRING:  'EXPIRING',
  EXPIRED:   'EXPIRED',
  SUSPENDED: 'SUSPENDED',
} as const;

const TRAINING_STATUS = {
  PLANNED:   'PLANNED',
  COMPLETED: 'COMPLETED',
  MISSED:    'MISSED',
  CANCELLED: 'CANCELLED',
} as const;

const REMEDIATION_STATUS = {
  PENDING:     'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
  CANCELLED:   'CANCELLED',
} as const;

// Alerte permis à X jours avant expiry (configurable via DriverRestConfig; ici valeur par défaut)
const DEFAULT_LICENSE_ALERT_DAYS = 30;

@Injectable()
export class DriverProfileService {
  private readonly logger = new Logger(DriverProfileService.name);

  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
    private readonly workflow: WorkflowEngine,
  ) {}

  // ─── Scope helpers ────────────────────────────────────────────────────────
  //
  // Rappel modèle : Staff.userId référence User.id — staff.id et user.id sont
  // DEUX ids différents. Les endpoints drivers exposent :staffId (l'id du
  // Staff), pas l'id du User. ScopeContext.userId est l'id User (issu de la
  // session). Pour valider un scope='own', il faut donc traduire staffId en
  // staff.userId via une lecture DB et comparer à scope.userId.

  private async _assertStaffOwnership(
    tenantId: string,
    staffId:  string,
    scope?:   ScopeContext,
  ): Promise<void> {
    if (!scope || scope.scope !== 'own') return;
    const staff = await this.prisma.staff.findFirst({
      where:  { id: staffId, tenantId },
      select: { userId: true },
    });
    if (!staff || staff.userId !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — staff not owned by actor`);
    }
  }

  // ─── Rest Config ──────────────────────────────────────────────────────────

  async getRestConfig(tenantId: string) {
    return this.prisma.driverRestConfig.upsert({
      where:  { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  async updateRestConfig(tenantId: string, dto: {
    minRestMinutes?: number;
    maxDrivingMinutesPerDay?: number;
    maxDrivingMinutesPerWeek?: number;
    alertBeforeEndRestMin?: number;
  }) {
    return this.prisma.driverRestConfig.upsert({
      where:  { tenantId },
      create: { tenantId, ...dto },
      update: dto,
    });
  }

  // ─── Driver Licenses ──────────────────────────────────────────────────────

  async createLicense(tenantId: string, dto: CreateDriverLicenseDto) {
    if (!dto.staffId?.trim()) {
      throw new BadRequestException('staffId is required');
    }

    const category = dto.category.toUpperCase();

    // Unicité : un seul permis par chauffeur et catégorie
    const existing = await this.prisma.driverLicense.findFirst({
      where: { tenantId, staffId: dto.staffId, category },
    });
    if (existing) {
      throw new ConflictException(
        `Ce chauffeur possède déjà un permis catégorie ${category}`,
      );
    }

    const expiresAt = new Date(dto.expiresAt);
    const status    = this._computeLicenseStatus(expiresAt, DEFAULT_LICENSE_ALERT_DAYS);

    // Upload du scan si fichier fourni
    let fileKey: string | undefined;
    if (dto.file?.buffer?.length) {
      fileKey = await this._uploadLicenseScan(tenantId, dto.staffId, dto.file);
    }

    const license = await this.prisma.driverLicense.create({
      data: {
        tenantId,
        staffId:      dto.staffId,
        category,
        licenseNo:    dto.licenseNo,
        issuedAt:     new Date(dto.issuedAt),
        expiresAt,
        issuingState: dto.issuingState,
        status,
        fileKey,
      },
    });

    // Write-through : Attachment(LICENSE) si fichier
    if (dto.file?.buffer?.length && fileKey) {
      await this._createLicenseAttachment(tenantId, dto.staffId, dto.file, fileKey);
    }

    // Write-through : sync vers StaffAssignment.licenseData
    await this._syncLicenseToAssignment(tenantId, dto.staffId);

    return license;
  }

  async updateLicense(tenantId: string, id: string, dto: UpdateDriverLicenseDto) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${id} introuvable`);

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : lic.expiresAt;
    const status    = dto.status ?? this._computeLicenseStatus(expiresAt, DEFAULT_LICENSE_ALERT_DAYS);

    // Upload du nouveau scan si fourni
    let fileKey: string | undefined;
    if (dto.file?.buffer?.length) {
      fileKey = await this._uploadLicenseScan(tenantId, lic.staffId, dto.file);
    }

    const updated = await this.prisma.driverLicense.update({
      where: { id },
      data: {
        licenseNo:    dto.licenseNo,
        issuedAt:     dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt,
        issuingState: dto.issuingState,
        status,
        ...(fileKey ? { fileKey } : {}),
      },
    });

    // Write-through : Attachment(LICENSE) si nouveau fichier
    if (dto.file?.buffer?.length && fileKey) {
      await this._createLicenseAttachment(tenantId, lic.staffId, dto.file, fileKey);
    }

    // Write-through : sync vers StaffAssignment.licenseData
    await this._syncLicenseToAssignment(lic.tenantId, lic.staffId);

    return updated;
  }

  async getLicensesForDriver(tenantId: string, staffId: string, scope?: ScopeContext) {
    await this._assertStaffOwnership(tenantId, staffId, scope);
    return this.prisma.driverLicense.findMany({
      where:   { tenantId, staffId },
      orderBy: { expiresAt: 'asc' },
    });
  }

  async getLicenseUploadUrl(tenantId: string, licenseId: string) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id: licenseId, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${licenseId} introuvable`);

    const key = `${tenantId}/drivers/${lic.staffId}/licenses/${licenseId}-${Date.now()}.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.driverLicense.update({ where: { id: licenseId }, data: { fileKey: key } });
    return { uploadUrl: url.url, fileKey: key, expiresAt: url.expiresAt };
  }

  async getAllLicenses(tenantId: string) {
    const licenses = await this.prisma.driverLicense.findMany({
      where:   { tenantId },
      orderBy: { expiresAt: 'asc' },
    });

    // Enrichir avec le nom du chauffeur (pas de relation Prisma sur DriverLicense)
    const staffIds = [...new Set(licenses.map(l => l.staffId))];
    const staffList = staffIds.length > 0
      ? await this.prisma.staff.findMany({
          where:   { id: { in: staffIds }, tenantId },
          include: { user: { select: { email: true, name: true } } },
        })
      : [];
    const staffMap = new Map(staffList.map(s => [s.id, s]));

    // Réconciliation : pour les permis sans fileKey, chercher un Attachment(LICENSE)
    const licensesWithoutFile = licenses.filter(l => !l.fileKey);
    let attachmentMap = new Map<string, string>(); // staffId → storageKey
    if (licensesWithoutFile.length > 0) {
      const userIds = licensesWithoutFile
        .map(l => staffMap.get(l.staffId))
        .filter(Boolean)
        .map(s => s!.userId);
      if (userIds.length > 0) {
        const attachments = await this.prisma.attachment.findMany({
          where:   { tenantId, entityType: 'STAFF', entityId: { in: userIds }, kind: 'LICENSE' },
          orderBy: { createdAt: 'desc' },
        });
        // Map userId → storageKey (most recent first)
        const userToStaff = new Map(staffList.map(s => [s.userId, s.id]));
        for (const att of attachments) {
          const sid = userToStaff.get(att.entityId);
          if (sid && !attachmentMap.has(sid)) {
            attachmentMap.set(sid, att.storageKey);
          }
        }
      }
    }

    return licenses.map(l => ({
      ...l,
      fileKey: l.fileKey || attachmentMap.get(l.staffId) || null,
      staff:   staffMap.get(l.staffId) ?? { user: { email: '?', name: null } },
    }));
  }

  async getLicenseScanUrl(tenantId: string, licenseId: string) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id: licenseId, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${licenseId} introuvable`);

    let fileKey = lic.fileKey;

    // Fallback : chercher un Attachment(LICENSE) si pas de fileKey direct
    if (!fileKey) {
      const staff = await this.prisma.staff.findFirst({
        where: { id: lic.staffId, tenantId }, select: { userId: true },
      });
      if (staff) {
        const att = await this.prisma.attachment.findFirst({
          where:   { tenantId, entityType: 'STAFF', entityId: staff.userId, kind: 'LICENSE' },
          orderBy: { createdAt: 'desc' },
        });
        if (att) fileKey = att.storageKey;
      }
    }

    if (!fileKey) throw new NotFoundException('Aucun scan trouvé pour ce permis');

    const signed = await this.storage.getDownloadUrl(tenantId, fileKey, DocumentType.MAINTENANCE_DOC);
    return { downloadUrl: signed.url, expiresAt: signed.expiresAt };
  }

  async getLicenseAlerts(tenantId: string) {
    return this.prisma.driverLicense.findMany({
      where:   { tenantId, status: { in: [LICENSE_STATUS.EXPIRING, LICENSE_STATUS.EXPIRED] } },
      orderBy: { expiresAt: 'asc' },
    });
  }

  // ─── Rest Periods ─────────────────────────────────────────────────────────

  /**
   * Vérifie si un chauffeur respecte la durée minimale de repos avant
   * de pouvoir être affecté à un nouveau trajet.
   * Retourne { canDrive: boolean, restRemainingMinutes: number }.
   */
  async checkRestCompliance(tenantId: string, staffId: string, scope?: ScopeContext): Promise<{
    canDrive: boolean;
    restRemainingMinutes: number;
    activeRestPeriod: { id: string; startedAt: Date } | null;
  }> {
    await this._assertStaffOwnership(tenantId, staffId, scope);
    const config = await this.getRestConfig(tenantId);

    // Cherche une période de repos ouverte (endedAt null)
    const active = await this.prisma.driverRestPeriod.findFirst({
      where:   { tenantId, staffId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (active) {
      const elapsedMin = Math.floor((Date.now() - active.startedAt.getTime()) / 60_000);
      const remaining  = config.minRestMinutes - elapsedMin;
      return {
        canDrive:             remaining <= 0,
        restRemainingMinutes: Math.max(0, remaining),
        activeRestPeriod:     { id: active.id, startedAt: active.startedAt },
      };
    }

    // Vérifie la dernière période fermée — était-elle suffisamment longue ?
    const last = await this.prisma.driverRestPeriod.findFirst({
      where:   { tenantId, staffId, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
    });

    if (!last || !last.endedAt) {
      // Pas d'historique — on laisse passer (premier trajet)
      return { canDrive: true, restRemainingMinutes: 0, activeRestPeriod: null };
    }

    const minutesSinceLastRest = Math.floor((Date.now() - last.endedAt.getTime()) / 60_000);
    // Si le temps depuis la fin du dernier repos dépasse la limite journalière, on bloque
    if (minutesSinceLastRest > config.maxDrivingMinutesPerDay) {
      return {
        canDrive:             false,
        restRemainingMinutes: config.minRestMinutes,
        activeRestPeriod:     null,
      };
    }

    return { canDrive: true, restRemainingMinutes: 0, activeRestPeriod: null };
  }

  async startRestPeriod(tenantId: string, dto: StartRestPeriodDto, scope?: ScopeContext) {
    await this._assertStaffOwnership(tenantId, dto.staffId, scope);
    // Ferme toute période ouverte existante (défensive — ne devrait pas arriver)
    await this.prisma.driverRestPeriod.updateMany({
      where: { tenantId, staffId: dto.staffId, endedAt: null },
      data:  { endedAt: new Date(dto.startedAt) },
    });

    const period = await this.prisma.driverRestPeriod.create({
      data: {
        tenantId,
        staffId:   dto.staffId,
        startedAt: new Date(dto.startedAt),
        source:    dto.source.toUpperCase(),
        notes:     dto.notes,
      },
    });

    await this._publishDriverEvent(tenantId, dto.staffId, EventTypes.DRIVER_REST_STARTED, {
      restPeriodId: period.id,
      source:       period.source,
    });

    return period;
  }

  async endRestPeriod(tenantId: string, periodId: string, dto: EndRestPeriodDto, scope?: ScopeContext) {
    const period = await this.prisma.driverRestPeriod.findFirst({
      where: { id: periodId, tenantId },
    });
    if (!period) throw new NotFoundException(`Période de repos ${periodId} introuvable`);
    await this._assertStaffOwnership(tenantId, period.staffId, scope);
    if (period.endedAt) throw new BadRequestException('Période déjà terminée');

    const config      = await this.getRestConfig(tenantId);
    const endedAt     = new Date(dto.endedAt);
    const durationMin = Math.floor((endedAt.getTime() - period.startedAt.getTime()) / 60_000);

    if (durationMin < config.minRestMinutes) {
      // Alerte violation — on enregistre quand même, mais on publie un événement
      await this._publishDriverEvent(tenantId, period.staffId, EventTypes.DRIVER_REST_VIOLATION, {
        restPeriodId:    periodId,
        durationMinutes: durationMin,
        requiredMinutes: config.minRestMinutes,
      });
    }

    const updated = await this.prisma.driverRestPeriod.update({
      where: { id: periodId },
      data:  { endedAt },
    });

    await this._publishDriverEvent(tenantId, period.staffId, EventTypes.DRIVER_REST_ENDED, {
      restPeriodId:    periodId,
      durationMinutes: durationMin,
      source:          'MANUAL',
    });

    return updated;
  }

  /**
   * Ferme automatiquement les périodes de repos dont la durée minimale
   * est atteinte. Appelé par le cron toutes les 5 minutes.
   */
  async autoCloseExpiredRestPeriods(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    let closed = 0;

    for (const tenant of tenants) {
      const config = await this.getRestConfig(tenant.id);

      const cutoff = new Date(Date.now() - config.minRestMinutes * 60_000);
      const expired = await this.prisma.driverRestPeriod.findMany({
        where: {
          tenantId:  tenant.id,
          endedAt:   null,
          startedAt: { lte: cutoff },
        },
      });

      for (const period of expired) {
        const endedAt     = new Date(period.startedAt.getTime() + config.minRestMinutes * 60_000);
        const durationMin = config.minRestMinutes;

        await this.prisma.driverRestPeriod.update({
          where: { id: period.id },
          data:  { endedAt },
        });

        await this._publishDriverEvent(tenant.id, period.staffId, EventTypes.DRIVER_REST_COMPLETED, {
          restPeriodId:    period.id,
          durationMinutes: durationMin,
          source:          'AUTO_CLOSED',
        });

        closed++;
      }
    }

    return closed;
  }

  async getRestHistory(tenantId: string, staffId: string, limit = 20, scope?: ScopeContext) {
    await this._assertStaffOwnership(tenantId, staffId, scope);
    return this.prisma.driverRestPeriod.findMany({
      where:   { tenantId, staffId },
      orderBy: { startedAt: 'desc' },
      take:    limit,
    });
  }

  /**
   * Chauffeurs actuellement en repos (endedAt = null).
   * Utilisé par la vue admin/manager mobile Planning > Repos pour voir
   * en un coup d'œil qui est indisponible maintenant.
   *
   * Scope agency : si scope.agency, on filtre via Staff.agencyId.
   */
  async getActiveRestPeriods(tenantId: string, scope?: ScopeContext) {
    const agencyFilter = scope?.scope === 'agency' && scope.agencyId
      ? { staff: { agencyId: scope.agencyId } }
      : {};

    const periods = await this.prisma.driverRestPeriod.findMany({
      where: {
        tenantId,
        endedAt: null,
        ...agencyFilter,
      },
      orderBy: { startedAt: 'desc' },
      take:    100,
    });

    if (periods.length === 0) return [];

    const staffIds = Array.from(new Set(periods.map(p => p.staffId)));
    const staffs = await this.prisma.staff.findMany({
      where:   { id: { in: staffIds }, tenantId },
      select: {
        id:       true,
        userId:   true,
        agencyId: true,
      },
    });
    const userIds = Array.from(new Set(staffs.map(s => s.userId).filter(Boolean) as string[]));
    const users = userIds.length > 0
      ? await this.prisma.user.findMany({
          where:   { id: { in: userIds }, tenantId },
          select: { id: true, name: true, email: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.id, u]));
    const staffMap = new Map(staffs.map(s => [s.id, s]));

    const now = Date.now();
    return periods.map(p => {
      const s = staffMap.get(p.staffId) ?? null;
      const u = s?.userId ? userMap.get(s.userId) ?? null : null;
      const durationMin = Math.round((now - p.startedAt.getTime()) / 60_000);
      return {
        id:          p.id,
        staffId:     p.staffId,
        startedAt:   p.startedAt,
        source:      p.source,
        notes:       p.notes,
        durationMin,
        agencyId:    s?.agencyId ?? null,
        driver:      u,
      };
    });
  }

  // ─── Training Types ───────────────────────────────────────────────────────

  async createTrainingType(tenantId: string, dto: CreateTrainingTypeDto) {
    return this.prisma.driverTrainingType.create({
      data: {
        tenantId,
        name:          dto.name,
        code:          dto.code.toUpperCase(),
        frequencyDays: dto.frequencyDays ?? 365,
        durationHours: dto.durationHours ?? 8,
        isMandatory:   dto.isMandatory ?? true,
      },
    });
  }

  async listTrainingTypes(tenantId: string) {
    return this.prisma.driverTrainingType.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // ─── Driver Trainings ─────────────────────────────────────────────────────

  async scheduleTraining(tenantId: string, dto: ScheduleTrainingDto) {
    const type = await this.prisma.driverTrainingType.findFirst({
      where: { id: dto.typeId, tenantId },
    });
    if (!type) throw new NotFoundException(`Type de formation ${dto.typeId} introuvable`);

    return this.prisma.driverTraining.create({
      data: {
        tenantId,
        staffId:      dto.staffId,
        typeId:       dto.typeId,
        scheduledAt:  new Date(dto.scheduledAt),
        trainerName:  dto.trainerName,
        locationName: dto.locationName,
        notes:        dto.notes,
        status:       TRAINING_STATUS.PLANNED,
      },
    });
  }

  async completeTraining(
    tenantId: string,
    trainingId: string,
    dto: CompleteTrainingDto,
    actor?: CurrentUserPayload,
  ) {
    const training = await this.prisma.driverTraining.findFirst({
      where:   { id: trainingId, tenantId },
      include: { type: true },
    });
    if (!training) throw new NotFoundException(`Formation ${trainingId} introuvable`);

    // Transition blueprint-driven : PLANNED → COMPLETED (action `complete`).
    // Le blueprint couvre aussi IN_PROGRESS → COMPLETED pour les formations qui
    // ont été démarrées explicitement (action `start`).
    await this.workflow.transition(
      training as Parameters<typeof this.workflow.transition>[0],
      { action: 'complete', actor: actor ?? SYSTEM_ACTOR },
      {
        aggregateType: 'DriverTraining',
        persist: async (entity, state, p) => {
          return p.driverTraining.update({
            where: { id: entity.id },
            data: {
              status:      state,
              completedAt: new Date(dto.completedAt),
              trainerName: dto.trainerName ?? training.trainerName ?? undefined,
              notes:       dto.notes,
              version:     { increment: 1 },
            },
          }) as Promise<typeof entity>;
        },
      },
    );

    // Planifier automatiquement la prochaine session selon frequencyDays
    const completed = await this.prisma.driverTraining.findUniqueOrThrow({ where: { id: trainingId } });
    const nextDate = new Date(completed.completedAt!);
    nextDate.setDate(nextDate.getDate() + training.type.frequencyDays);

    await this.prisma.driverTraining.create({
      data: {
        tenantId,
        staffId:     training.staffId,
        typeId:      training.typeId,
        scheduledAt: nextDate,
        status:      TRAINING_STATUS.PLANNED,
      },
    });

    return completed;
  }

  async getTrainingUploadUrl(tenantId: string, trainingId: string) {
    const training = await this.prisma.driverTraining.findFirst({ where: { id: trainingId, tenantId } });
    if (!training) throw new NotFoundException(`Formation ${trainingId} introuvable`);

    const key = `${tenantId}/drivers/${training.staffId}/trainings/${trainingId}-${Date.now()}.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.driverTraining.update({ where: { id: trainingId }, data: { fileKey: key } });
    return { uploadUrl: url.url, fileKey: key, expiresAt: url.expiresAt };
  }

  async getTrainingsForDriver(tenantId: string, staffId: string, scope?: ScopeContext) {
    await this._assertStaffOwnership(tenantId, staffId, scope);
    return this.prisma.driverTraining.findMany({
      where:   { tenantId, staffId },
      include: { type: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async getOverdueTrainings(tenantId: string) {
    return this.prisma.driverTraining.findMany({
      where: {
        tenantId,
        status:      TRAINING_STATUS.PLANNED,
        scheduledAt: { lt: new Date() },
      },
      include: { type: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  // ─── Stats (KPIs) ─────────────────────────────────────────────────────────

  async getStats(tenantId: string) {
    const [licenseAlerts, overdueTrainings, remediationRules, drivers] = await Promise.all([
      this.prisma.driverLicense.count({
        where: { tenantId, status: { in: [LICENSE_STATUS.EXPIRING, LICENSE_STATUS.EXPIRED] } },
      }),
      this.prisma.driverTraining.count({
        where: { tenantId, status: TRAINING_STATUS.PLANNED, scheduledAt: { lt: new Date() } },
      }),
      this.prisma.driverRemediationRule.count({
        where: { tenantId, isActive: true },
      }),
      this.prisma.staff.findMany({
        where: { tenantId, status: 'ACTIVE', assignments: { some: { role: 'DRIVER', status: 'ACTIVE' } } },
        select: { id: true },
      }),
    ]);

    // Chauffeurs bloqués = ceux avec une période de repos ouverte non terminée
    const blockedCount = drivers.length > 0
      ? await this.prisma.driverRestPeriod.groupBy({
          by:    ['staffId'],
          where: { tenantId, staffId: { in: drivers.map(d => d.id) }, endedAt: null },
        }).then(g => g.length)
      : 0;

    return {
      licenseAlerts,
      driversBlocked:    blockedCount,
      remediationRules,
      overdueTrainings,
    };
  }

  // ─── Remediation Rules ────────────────────────────────────────────────────

  async createRemediationRule(tenantId: string, dto: CreateRemediationRuleDto) {
    return this.prisma.driverRemediationRule.create({
      data: {
        tenantId,
        name:                dto.name,
        scoreBelowThreshold: dto.scoreBelowThreshold,
        actionType:          dto.actionType.toUpperCase(),
        trainingTypeId:      dto.trainingTypeId,
        suspensionDays:      dto.suspensionDays,
        priority:            dto.priority ?? 0,
      },
    });
  }

  async listRemediationRules(tenantId: string) {
    return this.prisma.driverRemediationRule.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { priority: 'asc' },
    });
  }

  async updateRemediationRule(
    tenantId: string,
    id: string,
    dto: Partial<CreateRemediationRuleDto> & { isActive?: boolean },
  ) {
    const rule = await this.prisma.driverRemediationRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException(`Règle ${id} introuvable`);
    return this.prisma.driverRemediationRule.update({
      where: { id },
      data: {
        name:                dto.name,
        scoreBelowThreshold: dto.scoreBelowThreshold,
        actionType:          dto.actionType ? dto.actionType.toUpperCase() : undefined,
        trainingTypeId:      dto.trainingTypeId,
        suspensionDays:      dto.suspensionDays,
        priority:            dto.priority,
        isActive:            dto.isActive,
      },
    });
  }

  async deleteRemediationRule(tenantId: string, id: string) {
    const rule = await this.prisma.driverRemediationRule.findFirst({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException(`Règle ${id} introuvable`);
    const res = await this.prisma.driverRemediationRule.updateMany({
      where: { id, tenantId },
      data:  { isActive: false },
    });
    if (res.count === 0) throw new NotFoundException(`Règle ${id} introuvable`);
    return this.prisma.driverRemediationRule.findFirst({ where: { id, tenantId } });
  }

  async deleteLicense(tenantId: string, id: string) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${id} introuvable`);
    const res = await this.prisma.driverLicense.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Permis ${id} introuvable`);

    // Write-through : sync vers StaffAssignment.licenseData (après suppression)
    await this._syncLicenseToAssignment(tenantId, lic.staffId);

    return { ok: true };
  }

  async deleteTraining(tenantId: string, id: string) {
    const training = await this.prisma.driverTraining.findFirst({ where: { id, tenantId } });
    if (!training) throw new NotFoundException(`Formation ${id} introuvable`);
    if (training.status === TRAINING_STATUS.COMPLETED) {
      throw new BadRequestException('Une formation complétée ne peut pas être supprimée');
    }
    const res = await this.prisma.driverTraining.deleteMany({ where: { id, tenantId } });
    if (res.count === 0) throw new NotFoundException(`Formation ${id} introuvable`);
    return { ok: true };
  }

  /**
   * Point d'entrée principal du moteur de remédiation.
   * Appelé lorsque le score CRM d'un chauffeur est mis à jour.
   * Évalue toutes les règles actives dans l'ordre de priorité.
   * Ne crée une action que si aucune action PENDING/IN_PROGRESS du même type n'existe déjà.
   */
  async evaluateRemediationForDriver(tenantId: string, staffId: string, currentScore: number) {
    const rules = await this.prisma.driverRemediationRule.findMany({
      where:   { tenantId, isActive: true, scoreBelowThreshold: { gte: currentScore } },
      orderBy: { priority: 'asc' },
    });

    if (rules.length === 0) return [];

    const triggered: string[] = [];

    for (const rule of rules) {
      // Éviter les doublons : skip si action active de cette règle existe déjà
      const existing = await this.prisma.driverRemediationAction.findFirst({
        where: {
          tenantId,
          staffId,
          ruleId: rule.id,
          status: { in: [REMEDIATION_STATUS.PENDING, REMEDIATION_STATUS.IN_PROGRESS] },
        },
      });
      if (existing) continue;

      const dueAt = rule.suspensionDays
        ? new Date(Date.now() + rule.suspensionDays * 24 * 60 * 60 * 1000)
        : undefined;

      const action = await this.prisma.driverRemediationAction.create({
        data: {
          tenantId,
          staffId,
          ruleId:         rule.id,
          scoreAtTrigger: currentScore,
          status:         REMEDIATION_STATUS.PENDING,
          dueAt,
        },
      });

      // Si la règle déclenche une formation, la planifier immédiatement
      if (rule.actionType === 'TRAINING' && rule.trainingTypeId) {
        const scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + 7); // dans 7 jours par défaut
        await this.prisma.driverTraining.create({
          data: {
            tenantId,
            staffId,
            typeId:      rule.trainingTypeId,
            scheduledAt,
            status:      TRAINING_STATUS.PLANNED,
            notes:       `Remédiation automatique — action ${action.id}`,
          },
        });
      }

      await this._publishDriverEvent(tenantId, staffId, EventTypes.DRIVER_REMEDIATION_TRIGGERED, {
        actionId:   action.id,
        ruleId:     rule.id,
        actionType: rule.actionType,
        score:      currentScore,
        threshold:  rule.scoreBelowThreshold,
      });

      triggered.push(action.id);
    }

    return triggered;
  }

  async getRemediationActionsForDriver(tenantId: string, staffId: string) {
    return this.prisma.driverRemediationAction.findMany({
      where:   { tenantId, staffId },
      include: { rule: true },
      orderBy: { triggeredAt: 'desc' },
    });
  }

  async updateRemediationAction(tenantId: string, actionId: string, dto: {
    status: string;
    completedAt?: string;
    notes?: string;
  }) {
    const action = await this.prisma.driverRemediationAction.findFirst({
      where: { id: actionId, tenantId },
    });
    if (!action) throw new NotFoundException(`Action de remédiation ${actionId} introuvable`);

    return this.prisma.driverRemediationAction.update({
      where: { id: actionId },
      data: {
        status:      dto.status.toUpperCase(),
        completedAt: dto.completedAt ? new Date(dto.completedAt) : undefined,
        notes:       dto.notes,
      },
    });
  }

  // ─── Scheduler : recompute license statuses daily ────────────────────────

  /**
   * Cross-tenant cron — scan global DES licences de TOUS les tenants et recalcul
   * des statuts. Chaque update est scoped par `id + tenantId` (defense-in-depth)
   * pour empêcher une bascule cross-tenant accidentelle en cas de refactor.
   * RLS PG n'est pas actif (pas de request context), donc le filtre query est
   * la seule garantie — on l'ajoute explicitement.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async refreshLicenseStatuses(): Promise<void> {
    this.logger.log('Refreshing driver license statuses…');

    const licenses = await this.prisma.driverLicense.findMany({
      where: { status: { not: LICENSE_STATUS.SUSPENDED } },
    });

    let updated = 0;
    for (const lic of licenses) {
      const newStatus = this._computeLicenseStatus(lic.expiresAt, DEFAULT_LICENSE_ALERT_DAYS);
      if (newStatus !== lic.status) {
        // updateMany avec tenantId en condition racine → defense-in-depth.
        await this.prisma.driverLicense.updateMany({
          where: { id: lic.id, tenantId: lic.tenantId },
          data:  { status: newStatus },
        });
        if (newStatus === LICENSE_STATUS.EXPIRING || newStatus === LICENSE_STATUS.EXPIRED) {
          await this._publishDriverEvent(lic.tenantId, lic.staffId, EventTypes.DRIVER_LICENSE_EXPIRING, {
            licenseId: lic.id,
            category:  lic.category,
            expiresAt: lic.expiresAt,
            status:    newStatus,
          });
        }
        updated++;
      }
    }
    this.logger.log(`License statuses refreshed: ${updated} changes`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async alertOverdueTrainings(): Promise<void> {
    this.logger.log('Checking overdue trainings…');

    const overdue = await this.prisma.driverTraining.findMany({
      where: {
        status:      TRAINING_STATUS.PLANNED,
        scheduledAt: { lt: new Date() },
      },
      include: { type: true },
    });

    for (const t of overdue) {
      await this._publishDriverEvent(t.tenantId, t.staffId, EventTypes.DRIVER_TRAINING_DUE, {
        trainingId: t.id,
        typeCode:   t.type.code,
        scheduledAt: t.scheduledAt,
      });
    }
    this.logger.log(`Overdue training alerts sent: ${overdue.length}`);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Upload le scan du permis dans MinIO et retourne la storageKey.
   */
  private async _uploadLicenseScan(
    tenantId: string,
    staffId:  string,
    file:     { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<string> {
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 160);
    const key = `drivers/${staffId}/licenses/${Date.now()}-${safeName}`;
    await this.storage.putObject(tenantId, key, file.buffer, file.mimetype);
    return key;
  }

  /**
   * Crée un Attachment(LICENSE) lié au Staff pour garder le scan visible
   * dans la section pièces jointes du personnel.
   */
  private async _createLicenseAttachment(
    tenantId:   string,
    staffId:    string,
    file:       { buffer: Buffer; originalname: string; mimetype: string; size: number },
    storageKey: string,
  ) {
    const { createHash } = await import('node:crypto');
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const safeName = file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 160);

    // Le Staff.userId est nécessaire car Attachment.entityId = userId pour entityType=STAFF
    const staff = await this.prisma.staff.findFirst({
      where:  { id: staffId, tenantId },
      select: { userId: true },
    });
    if (!staff) return;

    await this.prisma.attachment.create({
      data: {
        tenantId,
        entityType: 'STAFF',
        entityId:   staff.userId,
        kind:       'LICENSE',
        fileName:   safeName,
        mimeType:   file.mimetype,
        size:       file.size,
        storageKey,
        checksum,
      },
    });
  }

  /**
   * Write-through : synchronise les permis DriverLicense vers
   * StaffAssignment.licenseData (snapshot dénormalisé pour affichage rapide).
   *
   * Agrège TOUS les permis actifs du chauffeur dans un objet JSON unique
   * stocké sur chaque assignment DRIVER actif de ce staff.
   */
  private async _syncLicenseToAssignment(tenantId: string, staffId: string) {
    const licenses = await this.prisma.driverLicense.findMany({
      where:   { tenantId, staffId },
      orderBy: { expiresAt: 'asc' },
    });

    // Snapshot : le premier permis catégorie D/EC (celui que le SchedulingGuard vérifie)
    // + tableau complet pour affichage
    const primary = licenses.find(l => ['D', 'EC', 'D+E'].includes(l.category));
    const licenseData = primary
      ? {
          licenseNo:    primary.licenseNo,
          category:     primary.category,
          expiresAt:    primary.expiresAt.toISOString().slice(0, 10),
          issuingState: primary.issuingState,
          status:       primary.status,
          allLicenses:  licenses.map(l => ({
            category:  l.category,
            licenseNo: l.licenseNo,
            expiresAt: l.expiresAt.toISOString().slice(0, 10),
            status:    l.status,
          })),
        }
      : {};

    // Mettre à jour toutes les assignments DRIVER actives de ce staff
    await this.prisma.staffAssignment.updateMany({
      where: { staffId, role: 'DRIVER', status: 'ACTIVE' },
      data:  { licenseData },
    });
  }

  private _computeLicenseStatus(expiresAt: Date, alertDays: number): string {
    const now        = new Date();
    const alertLimit = new Date(expiresAt.getTime() - alertDays * 24 * 60 * 60 * 1000);
    if (now > expiresAt)   return LICENSE_STATUS.EXPIRED;
    if (now >= alertLimit) return LICENSE_STATUS.EXPIRING;
    return LICENSE_STATUS.VALID;
  }

  private async _publishDriverEvent(
    tenantId:    string,
    staffId:     string,
    type:        string,
    payload:     Record<string, unknown>,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type,
      tenantId,
      aggregateId:   staffId,
      aggregateType: 'Driver',
      payload:       { staffId, ...payload },
      occurredAt:    new Date(),
    };
    // Pas de transaction englobante — on utilise le client Prisma principal
    // comme PrismaTransactionClient (même interface pour create/update).
    await this.eventBus.publish(event, this.prisma);
  }
}
