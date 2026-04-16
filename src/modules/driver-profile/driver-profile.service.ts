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

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateDriverLicenseDto {
  staffId:      string;
  category:     string;        // "B", "D", "EC"…
  licenseNo:    string;
  issuedAt:     string;        // ISO date
  expiresAt:    string;        // ISO date
  issuingState?: string;
}

export interface UpdateDriverLicenseDto {
  licenseNo?:    string;
  issuedAt?:     string;
  expiresAt?:    string;
  issuingState?: string;
  status?:       string;       // VALID | EXPIRING | EXPIRED | SUSPENDED
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
    const expiresAt = new Date(dto.expiresAt);
    const status    = this._computeLicenseStatus(expiresAt, DEFAULT_LICENSE_ALERT_DAYS);

    return this.prisma.driverLicense.create({
      data: {
        tenantId,
        staffId:      dto.staffId,
        category:     dto.category.toUpperCase(),
        licenseNo:    dto.licenseNo,
        issuedAt:     new Date(dto.issuedAt),
        expiresAt,
        issuingState: dto.issuingState,
        status,
      },
    });
  }

  async updateLicense(tenantId: string, id: string, dto: UpdateDriverLicenseDto) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${id} introuvable`);

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : lic.expiresAt;
    const status    = dto.status ?? this._computeLicenseStatus(expiresAt, DEFAULT_LICENSE_ALERT_DAYS);

    return this.prisma.driverLicense.update({
      where: { id },
      data: {
        licenseNo:    dto.licenseNo,
        issuedAt:     dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        expiresAt,
        issuingState: dto.issuingState,
        status,
      },
    });
  }

  async getLicensesForDriver(tenantId: string, staffId: string) {
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
    return { uploadUrl: url, fileKey: key };
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

  async completeTraining(tenantId: string, trainingId: string, dto: CompleteTrainingDto) {
    const training = await this.prisma.driverTraining.findFirst({
      where:   { id: trainingId, tenantId },
      include: { type: true },
    });
    if (!training) throw new NotFoundException(`Formation ${trainingId} introuvable`);

    const completed = await this.prisma.driverTraining.update({
      where: { id: trainingId },
      data: {
        status:      TRAINING_STATUS.COMPLETED,
        completedAt: new Date(dto.completedAt),
        trainerName: dto.trainerName ?? training.trainerName ?? undefined,
        notes:       dto.notes,
      },
    });

    // Planifier automatiquement la prochaine session selon frequencyDays
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
    return { uploadUrl: url, fileKey: key };
  }

  async getTrainingsForDriver(tenantId: string, staffId: string) {
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
    return this.prisma.driverRemediationRule.update({
      where: { id },
      data:  { isActive: false },
    });
  }

  async deleteLicense(tenantId: string, id: string) {
    const lic = await this.prisma.driverLicense.findFirst({ where: { id, tenantId } });
    if (!lic) throw new NotFoundException(`Permis ${id} introuvable`);
    await this.prisma.driverLicense.delete({ where: { id } });
    return { ok: true };
  }

  async deleteTraining(tenantId: string, id: string) {
    const training = await this.prisma.driverTraining.findFirst({ where: { id, tenantId } });
    if (!training) throw new NotFoundException(`Formation ${id} introuvable`);
    if (training.status === TRAINING_STATUS.COMPLETED) {
      throw new BadRequestException('Une formation complétée ne peut pas être supprimée');
    }
    await this.prisma.driverTraining.delete({ where: { id } });
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
        await this.prisma.driverLicense.update({
          where: { id: lic.id },
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
