/**
 * QhseService — Accidents, litiges et procédures QHSE.
 *
 * Responsabilités :
 *   - Catalogue AccidentSeverityType (par tenant)
 *   - CRUD AccidentReport + tiers (AccidentThirdParty) + blessures (AccidentInjury)
 *   - Référentiel hôpitaux (Hospital) + suivi médical (MedicalFollowUp)
 *   - Suivi des litiges (DisputeTracking) assurance/gré-à-gré + frais (DisputeExpense)
 *   - Procédures QHSE (QhseProcedure + QhseProcedureStep) configurables
 *   - Exécution pas à pas (QhseProcedureExecution + QhseStepExecution)
 *   - Déclenchement automatique de procédure à la création d'un accident grave
 *   - Publication d'événements ACCIDENT_REPORTED / QHSE_PROCEDURE_STARTED / DISPUTE_OPENED
 *
 * Règle d'or : les codes de sévérité, les triggers de procédure et les types de frais
 * sont tous libres et configurés par tenant dans la DB.
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { PrismaService }       from '../../infrastructure/database/prisma.service';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import { assertOwnership } from '../../common/helpers/scope-filter';
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
import { EventTypes }          from '../../common/types/domain-event.type';
import { v4 as uuidv4 }        from 'uuid';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateAccidentReportDto {
  tripId?:        string;
  busId?:         string;
  severityTypeId: string;
  reportedById:   string;
  reportedByRole: string;
  occurredAt:     string;          // ISO datetime
  gpsLat?:        number;
  gpsLng?:        number;
  locationDesc?:  string;
  description:    string;
  circumstance?:  string;
  incidentId?:    string;
}

export interface UpdateAccidentReportDto {
  description?:    string;
  circumstance?:   string;
  locationDesc?:   string;
  status?:         string;
  assignedQhseId?: string;
  closingNotes?:   string;
  closedAt?:       string;
  closedById?:     string;
}

export interface AddThirdPartyDto {
  type:          string;
  name?:         string;
  phone?:        string;
  plateNumber?:  string;
  vehicleModel?: string;
  insuranceRef?: string;
  notes?:        string;
}

export interface AddInjuryDto {
  personType:  string;
  personName?: string;
  ticketId?:   string;
  severity:    string;
  hospitalId?: string;
  hospitalName?: string;
  admittedAt?: string;
  medicalNotes?: string;
}

export interface AddMedicalFollowUpDto {
  date:               string;
  practitionerName?:  string;
  notes?:             string;
  nextAppointment?:   string;
}

export interface OpenDisputeDto {
  mode?:           string;           // INSURANCE | AMICABLE | LEGAL
  insurerRef?:     string;
  insurerName?:    string;
  adjusterId?:     string;
  estimatedTotal?: number;
}

export interface UpdateDisputeDto {
  mode?:            string;
  insurerRef?:      string;
  insurerName?:     string;
  adjusterId?:      string;
  status?:          string;
  estimatedTotal?:  number;
  advancedAmount?:  number;
  finalSettlement?: number;
  settledAt?:       string;
  closingNotes?:    string;
}

export interface AddDisputeExpenseDto {
  type:        string;
  description: string;
  amountXaf:   number;
  paidAt?:     string;
  approvedById?: string;
}

export interface CreateQhseProcedureDto {
  name:         string;
  triggerCode:  string;
  description?: string;
  steps:        {
    order:           number;
    description:     string;
    responsible:     string;
    isVerification?: boolean;
    isPhotoRequired?: boolean;
  }[];
}

export interface ExecuteStepDto {
  stepId:      string;
  executedById: string;
  isOk:        boolean;
  notes?:      string;
  photoKey?:   string;
}

@Injectable()
export class QhseService {
  private readonly logger = new Logger(QhseService.name);

  constructor(
    private readonly prisma:   PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ─── Accident Severity Types ──────────────────────────────────────────────

  async createSeverityType(tenantId: string, dto: {
    name: string; code: string; color?: string;
    requiresQhse?: boolean; requiresPolice?: boolean; requiresInsurer?: boolean;
    sortOrder?: number;
  }) {
    return this.prisma.accidentSeverityType.create({
      data: {
        tenantId,
        name:            dto.name,
        code:            dto.code.toUpperCase(),
        color:           dto.color ?? '#f59e0b',
        requiresQhse:    dto.requiresQhse ?? false,
        requiresPolice:  dto.requiresPolice ?? false,
        requiresInsurer: dto.requiresInsurer ?? false,
        sortOrder:       dto.sortOrder ?? 0,
      },
    });
  }

  async listSeverityTypes(tenantId: string) {
    return this.prisma.accidentSeverityType.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ─── Accident Reports ─────────────────────────────────────────────────────

  async createAccidentReport(tenantId: string, dto: CreateAccidentReportDto) {
    const severity = await this.prisma.accidentSeverityType.findFirst({
      where: { id: dto.severityTypeId, tenantId },
    });
    if (!severity) throw new NotFoundException(`Type de sévérité ${dto.severityTypeId} introuvable`);

    const report = await this.prisma.accidentReport.create({
      data: {
        tenantId,
        tripId:         dto.tripId,
        busId:          dto.busId,
        severityTypeId: dto.severityTypeId,
        reportedById:   dto.reportedById,
        reportedByRole: dto.reportedByRole.toUpperCase(),
        occurredAt:     new Date(dto.occurredAt),
        gpsLat:         dto.gpsLat,
        gpsLng:         dto.gpsLng,
        locationDesc:   dto.locationDesc,
        description:    dto.description,
        circumstance:   dto.circumstance,
        incidentId:     dto.incidentId,
        status:         'OPEN',
      },
      include: { severityType: true },
    });

    await this._publishEvent(tenantId, report.id, EventTypes.ACCIDENT_REPORTED, {
      reportId:        report.id,
      severityCode:    severity.code,
      requiresQhse:    severity.requiresQhse,
      requiresPolice:  severity.requiresPolice,
      requiresInsurer: severity.requiresInsurer,
      busId:           dto.busId,
      occurredAt:      dto.occurredAt,
    });

    // Si la sévérité nécessite une procédure QHSE, la déclencher automatiquement
    if (severity.requiresQhse) {
      await this._autoStartQhseProcedure(tenantId, report.id, severity.code, dto.reportedById);
    }

    return report;
  }

  async updateAccidentReport(tenantId: string, reportId: string, dto: UpdateAccidentReportDto) {
    const report = await this.prisma.accidentReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);

    return this.prisma.accidentReport.update({
      where: { id: reportId },
      data: {
        description:   dto.description,
        circumstance:  dto.circumstance,
        locationDesc:  dto.locationDesc,
        status:        dto.status?.toUpperCase(),
        assignedQhseId: dto.assignedQhseId,
        closingNotes:  dto.closingNotes,
        closedAt:      dto.closedAt ? new Date(dto.closedAt) : undefined,
        closedById:    dto.closedById,
      },
      include: { severityType: true, thirdParties: true, injuries: true },
    });
  }

  async getAccidentReport(tenantId: string, reportId: string, scope?: ScopeContext) {
    const report = await this.prisma.accidentReport.findFirst({
      where:   { id: reportId, tenantId },
      include: {
        severityType:   true,
        thirdParties:   true,
        injuries:       { include: { hospital: true, followUps: true } },
        disputeTracking: { include: { expenses: true } },
        procedureExecs: { include: { stepExecs: { include: { step: true } }, procedure: true } },
      },
    });
    if (scope) assertOwnership(scope, report, 'reportedById');
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    return report;
  }

  async listAccidentReports(tenantId: string, filters?: {
    status?: string; busId?: string; from?: string; to?: string;
  }) {
    return this.prisma.accidentReport.findMany({
      where: {
        tenantId,
        ...(filters?.status && { status: filters.status.toUpperCase() }),
        ...(filters?.busId  && { busId: filters.busId }),
        ...(filters?.from || filters?.to
          ? {
              occurredAt: {
                ...(filters.from && { gte: new Date(filters.from) }),
                ...(filters.to   && { lte: new Date(filters.to) }),
              },
            }
          : {}),
      },
      include: { severityType: true },
      orderBy: { occurredAt: 'desc' },
    });
  }

  async getAccidentPhotoUploadUrl(tenantId: string, reportId: string, filename: string, scope?: ScopeContext) {
    const report = await this.prisma.accidentReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    if (scope) assertOwnership(scope, report, 'reportedById');

    const key = `${tenantId}/accidents/${reportId}/${Date.now()}-${filename}`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    // Ajouter la clé dans le tableau photoKeys
    const current = (report.photoKeys as string[]) ?? [];
    await this.prisma.accidentReport.update({
      where: { id: reportId },
      data:  { photoKeys: [...current, key] },
    });

    return { uploadUrl: url, fileKey: key };
  }

  // ─── Third Parties ────────────────────────────────────────────────────────

  async addThirdParty(tenantId: string, reportId: string, dto: AddThirdPartyDto, scope?: ScopeContext) {
    const report = await this.prisma.accidentReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    if (scope) assertOwnership(scope, report, 'reportedById');

    return this.prisma.accidentThirdParty.create({
      data: { tenantId, reportId, ...dto, type: dto.type.toUpperCase() },
    });
  }

  async getThirdPartyStatementUploadUrl(tenantId: string, thirdPartyId: string, scope?: ScopeContext) {
    const tp = await this.prisma.accidentThirdParty.findFirst({
      where:   { id: thirdPartyId, tenantId },
      include: { report: { select: { reportedById: true } } },
    });
    if (!tp) throw new NotFoundException(`Tiers ${thirdPartyId} introuvable`);
    if (scope?.scope === 'own' && tp.report?.reportedById !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — third party not from owned report`);
    }

    const key = `${tenantId}/accidents/${tp.reportId}/thirds/${thirdPartyId}-statement.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.accidentThirdParty.update({ where: { id: thirdPartyId }, data: { statementFile: key } });
    return { uploadUrl: url, fileKey: key };
  }

  // ─── Injuries ─────────────────────────────────────────────────────────────

  async addInjury(tenantId: string, reportId: string, dto: AddInjuryDto, scope?: ScopeContext) {
    const report = await this.prisma.accidentReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);
    if (scope) assertOwnership(scope, report, 'reportedById');

    if (dto.hospitalId) {
      const hospital = await this.prisma.hospital.findFirst({ where: { id: dto.hospitalId, tenantId } });
      if (!hospital) throw new NotFoundException(`Hôpital ${dto.hospitalId} introuvable`);
    }

    return this.prisma.accidentInjury.create({
      data: {
        tenantId,
        reportId,
        personType:  dto.personType.toUpperCase(),
        personName:  dto.personName,
        ticketId:    dto.ticketId,
        severity:    dto.severity.toUpperCase(),
        hospitalId:  dto.hospitalId,
        hospitalName: dto.hospitalName,
        admittedAt:  dto.admittedAt ? new Date(dto.admittedAt) : undefined,
        medicalNotes: dto.medicalNotes,
      },
    });
  }

  async addMedicalFollowUp(tenantId: string, injuryId: string, dto: AddMedicalFollowUpDto) {
    const injury = await this.prisma.accidentInjury.findFirst({ where: { id: injuryId, tenantId } });
    if (!injury) throw new NotFoundException(`Blessure ${injuryId} introuvable`);

    return this.prisma.medicalFollowUp.create({
      data: {
        tenantId,
        injuryId,
        date:             new Date(dto.date),
        practitionerName: dto.practitionerName,
        notes:            dto.notes,
        nextAppointment:  dto.nextAppointment ? new Date(dto.nextAppointment) : undefined,
      },
    });
  }

  async getMedicalFollowUpUploadUrl(tenantId: string, followUpId: string) {
    const fu = await this.prisma.medicalFollowUp.findFirst({ where: { id: followUpId, tenantId } });
    if (!fu) throw new NotFoundException(`Suivi médical ${followUpId} introuvable`);

    const key = `${tenantId}/accidents/medical/${followUpId}-${Date.now()}.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.medicalFollowUp.update({ where: { id: followUpId }, data: { fileKey: key } });
    return { uploadUrl: url, fileKey: key };
  }

  // ─── Hospitals ────────────────────────────────────────────────────────────

  async createHospital(tenantId: string, dto: {
    name: string; city: string; address?: string; phone?: string;
    gpsLat?: number; gpsLng?: number;
  }) {
    return this.prisma.hospital.create({ data: { tenantId, ...dto } });
  }

  async listHospitals(tenantId: string) {
    return this.prisma.hospital.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { city: 'asc' },
    });
  }

  // ─── Dispute Tracking ─────────────────────────────────────────────────────

  async openDispute(tenantId: string, reportId: string, dto: OpenDisputeDto) {
    const report = await this.prisma.accidentReport.findFirst({ where: { id: reportId, tenantId } });
    if (!report) throw new NotFoundException(`Rapport ${reportId} introuvable`);

    const existing = await this.prisma.disputeTracking.findFirst({ where: { reportId } });
    if (existing) throw new BadRequestException('Un litige existe déjà pour ce rapport');

    const dispute = await this.prisma.disputeTracking.create({
      data: {
        tenantId,
        reportId,
        mode:           dto.mode?.toUpperCase() ?? 'INSURANCE',
        insurerRef:     dto.insurerRef,
        insurerName:    dto.insurerName,
        adjusterId:     dto.adjusterId,
        estimatedTotal: dto.estimatedTotal,
        status:         'OPEN',
      },
    });

    await this._publishEvent(tenantId, reportId, EventTypes.DISPUTE_OPENED, {
      disputeId: dispute.id,
      mode:      dispute.mode,
    });

    return dispute;
  }

  async updateDispute(tenantId: string, disputeId: string, dto: UpdateDisputeDto) {
    const dispute = await this.prisma.disputeTracking.findFirst({ where: { id: disputeId, tenantId } });
    if (!dispute) throw new NotFoundException(`Litige ${disputeId} introuvable`);

    const updated = await this.prisma.disputeTracking.update({
      where: { id: disputeId },
      data: {
        mode:            dto.mode?.toUpperCase(),
        insurerRef:      dto.insurerRef,
        insurerName:     dto.insurerName,
        adjusterId:      dto.adjusterId,
        status:          dto.status?.toUpperCase(),
        estimatedTotal:  dto.estimatedTotal,
        advancedAmount:  dto.advancedAmount,
        finalSettlement: dto.finalSettlement,
        settledAt:       dto.settledAt ? new Date(dto.settledAt) : undefined,
        closingNotes:    dto.closingNotes,
      },
    });

    if (updated.status === 'CLOSED' || updated.status === 'AGREED') {
      await this._publishEvent(tenantId, dispute.reportId, EventTypes.DISPUTE_SETTLED, {
        disputeId:       disputeId,
        finalSettlement: dto.finalSettlement,
      });
    }

    return updated;
  }

  async addDisputeExpense(tenantId: string, disputeId: string, dto: AddDisputeExpenseDto) {
    const dispute = await this.prisma.disputeTracking.findFirst({ where: { id: disputeId, tenantId } });
    if (!dispute) throw new NotFoundException(`Litige ${disputeId} introuvable`);

    return this.prisma.disputeExpense.create({
      data: {
        tenantId,
        disputeId,
        type:         dto.type.toUpperCase(),
        description:  dto.description,
        amountXaf:    dto.amountXaf,
        paidAt:       dto.paidAt ? new Date(dto.paidAt) : undefined,
        approvedById: dto.approvedById,
      },
    });
  }

  async getDisputeExpenseUploadUrl(tenantId: string, expenseId: string) {
    const exp = await this.prisma.disputeExpense.findFirst({ where: { id: expenseId, tenantId } });
    if (!exp) throw new NotFoundException(`Frais ${expenseId} introuvable`);

    const key = `${tenantId}/disputes/${exp.disputeId}/expenses/${expenseId}-${Date.now()}.pdf`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);

    await this.prisma.disputeExpense.update({ where: { id: expenseId }, data: { fileKey: key } });
    return { uploadUrl: url, fileKey: key };
  }

  async getDisputeSummary(tenantId: string, disputeId: string) {
    const dispute = await this.prisma.disputeTracking.findFirst({
      where:   { id: disputeId, tenantId },
      include: {
        expenses: true,
        report:   { include: { severityType: true } },
      },
    });
    if (!dispute) throw new NotFoundException(`Litige ${disputeId} introuvable`);

    const totalExpenses = dispute.expenses.reduce((sum, e) => sum + e.amountXaf, 0);
    return { ...dispute, totalExpenses };
  }

  // ─── QHSE Procedures ──────────────────────────────────────────────────────

  async createProcedure(tenantId: string, dto: CreateQhseProcedureDto) {
    return this.prisma.qhseProcedure.create({
      data: {
        tenantId,
        name:        dto.name,
        triggerCode: dto.triggerCode.toUpperCase(),
        description: dto.description,
        steps: {
          create: dto.steps.map(s => ({
            order:           s.order,
            description:     s.description,
            responsible:     s.responsible.toUpperCase(),
            isVerification:  s.isVerification ?? true,
            isPhotoRequired: s.isPhotoRequired ?? false,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  async listProcedures(tenantId: string) {
    return this.prisma.qhseProcedure.findMany({
      where:   { tenantId, isActive: true },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { triggerCode: 'asc' },
    });
  }

  // ─── QHSE Executions ──────────────────────────────────────────────────────

  async startProcedureExecution(tenantId: string, dto: {
    reportId: string; procedureId: string; startedById: string;
  }) {
    const [report, procedure] = await Promise.all([
      this.prisma.accidentReport.findFirst({ where: { id: dto.reportId, tenantId } }),
      this.prisma.qhseProcedure.findFirst({ where: { id: dto.procedureId, tenantId } }),
    ]);
    if (!report)    throw new NotFoundException(`Rapport ${dto.reportId} introuvable`);
    if (!procedure) throw new NotFoundException(`Procédure ${dto.procedureId} introuvable`);

    const execution = await this.prisma.qhseProcedureExecution.create({
      data: {
        tenantId,
        reportId:    dto.reportId,
        procedureId: dto.procedureId,
        startedById: dto.startedById,
        status:      'IN_PROGRESS',
      },
      include: { procedure: { include: { steps: { orderBy: { order: 'asc' } } } } },
    });

    await this._publishEvent(tenantId, dto.reportId, EventTypes.QHSE_PROCEDURE_STARTED, {
      executionId:  execution.id,
      procedureId:  dto.procedureId,
      triggerCode:  procedure.triggerCode,
      startedById:  dto.startedById,
    });

    return execution;
  }

  async executeStep(tenantId: string, executionId: string, dto: ExecuteStepDto) {
    const execution = await this.prisma.qhseProcedureExecution.findFirst({
      where:   { id: executionId, tenantId },
      include: { procedure: { include: { steps: true } }, stepExecs: true },
    });
    if (!execution) throw new NotFoundException(`Exécution ${executionId} introuvable`);
    if (execution.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Exécution déjà terminée ou annulée');
    }

    const step = execution.procedure.steps.find(s => s.id === dto.stepId);
    if (!step) throw new NotFoundException(`Étape ${dto.stepId} introuvable dans cette procédure`);

    if (step.isPhotoRequired && !dto.photoKey) {
      throw new BadRequestException(`L'étape ${step.order} nécessite une photo`);
    }

    const stepExec = await this.prisma.qhseStepExecution.upsert({
      where:  { executionId_stepId: { executionId, stepId: dto.stepId } },
      create: {
        executionId,
        stepId:      dto.stepId,
        executedById: dto.executedById,
        isOk:        dto.isOk,
        notes:       dto.notes,
        photoKey:    dto.photoKey,
      },
      update: {
        executedById: dto.executedById,
        executedAt:   new Date(),
        isOk:         dto.isOk,
        notes:        dto.notes,
        photoKey:     dto.photoKey,
      },
    });

    // Vérifier si toutes les étapes sont exécutées
    const allStepIds     = execution.procedure.steps.map(s => s.id);
    const executedStepIds = [
      ...execution.stepExecs.filter(s => s.stepId !== dto.stepId).map(s => s.stepId),
      dto.stepId,
    ];
    const allDone = allStepIds.every(id => executedStepIds.includes(id));

    if (allDone) {
      await this.prisma.qhseProcedureExecution.update({
        where: { id: executionId },
        data:  { status: 'COMPLETED', completedAt: new Date() },
      });
      await this._publishEvent(tenantId, execution.reportId, EventTypes.QHSE_PROCEDURE_COMPLETED, {
        executionId,
        procedureId: execution.procedureId,
      });
    }

    return stepExec;
  }

  async getExecution(tenantId: string, executionId: string) {
    const execution = await this.prisma.qhseProcedureExecution.findFirst({
      where:   { id: executionId, tenantId },
      include: {
        procedure: { include: { steps: { orderBy: { order: 'asc' } } } },
        stepExecs: { include: { step: true } },
      },
    });
    if (!execution) throw new NotFoundException(`Exécution ${executionId} introuvable`);
    return execution;
  }

  async getStepPhotoUploadUrl(tenantId: string, executionId: string, stepId: string) {
    const execution = await this.prisma.qhseProcedureExecution.findFirst({
      where: { id: executionId, tenantId },
    });
    if (!execution) throw new NotFoundException(`Exécution ${executionId} introuvable`);

    const key = `${tenantId}/qhse/${executionId}/${stepId}-${Date.now()}.jpg`;
    const url = await this.storage.getUploadUrl(tenantId, key, DocumentType.MAINTENANCE_DOC);
    return { uploadUrl: url, photoKey: key };
  }

  // ─── Auto-trigger QHSE procedure ─────────────────────────────────────────

  private async _autoStartQhseProcedure(
    tenantId:     string,
    reportId:     string,
    severityCode: string,
    startedById:  string,
  ) {
    const procedure = await this.prisma.qhseProcedure.findFirst({
      where: { tenantId, triggerCode: severityCode, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!procedure) {
      this.logger.warn(`Aucune procédure QHSE pour trigger ${severityCode} (tenant ${tenantId})`);
      return;
    }

    await this.startProcedureExecution(tenantId, {
      reportId,
      procedureId: procedure.id,
      startedById,
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _publishEvent(
    tenantId:  string,
    reportId:  string,
    type:      string,
    payload:   Record<string, unknown>,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type,
      tenantId,
      aggregateId:   reportId,
      aggregateType: 'AccidentReport',
      payload:       { reportId, ...payload },
      occurredAt:    new Date(),
    };
    await this.eventBus.publish(event, null);
  }
}
