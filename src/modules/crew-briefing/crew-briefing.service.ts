/**
 * CrewBriefingService — Briefing pré-départ de l'équipage (refonte v2 QHSE).
 *
 * Responsabilités :
 *   - Catalogue legacy `BriefingEquipmentType` (API v1, conservé pour
 *     rétro-compat avec l'ancien mobile / PageCrewBriefing historique).
 *   - Création d'un `CrewBriefingRecord` template-driven (v2) :
 *       * Résolution des items du BriefingTemplate actif du tenant
 *       * Items auto-calculés (INFO) — repos chauffeur, manifest, route
 *       * Double signature (briefeur + chauffeur + co-pilote optionnel)
 *       * Respect politiques tenant (BLOCK_DEPARTURE, WARN_ONLY, etc.)
 *       * Émission d'alertes sécurité sur items mandatory KO / repos KO
 *       * Override justifié d'un blocage (manager)
 *
 * Règles :
 *   - Tenant scope racine sur toutes les requêtes.
 *   - Un seul briefing par CrewAssignment (rejet sur doublon).
 *   - Events : `briefing.signed`, `briefing.override.applied`,
 *             `crew.briefing.completed` (legacy), `crew.briefing.equipment_missing` (legacy).
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Logger,
} from '@nestjs/common';
import { PrismaService }     from '../../infrastructure/database/prisma.service';
import type { ScopeContext } from '../../common/decorators/scope-context.decorator';
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes } from '../../common/types/domain-event.type';
import { v4 as uuidv4 } from 'uuid';

import { DriverRestCalculatorService } from './driver-rest-calculator.service';
import {
  TripSafetyAlertService,
  SafetyAlertSeverity,
} from './trip-safety-alert.service';
import type { ItemKind } from './briefing-template.service';

// ─── DTOs v1 (legacy, conservé pour compat ancien mobile / UI) ──────────────

export interface CheckedItemDto {
  equipmentTypeId: string;
  qty:             number;
  ok:              boolean;
  notes?:          string;
}

export interface CreateBriefingDto {
  assignmentId:  string;
  conductedById: string;
  checkedItems:  CheckedItemDto[];
  briefingNotes?: string;
  gpsLat?:       number;
  gpsLng?:       number;
}

// ─── DTOs v2 (template-driven) ───────────────────────────────────────────────

export interface CheckedItemV2Dto {
  itemId:        string;
  passed:        boolean;
  qty?:          number;                  // kind=QUANTITY
  notes?:        string;
  evidenceKeys?: string[];                // kind=* (photo / document)
  autoValue?:    unknown;                 // kind=INFO — snapshot de la valeur auto
}

export type SignatureMethod = 'PIN' | 'DRAW' | 'BIOMETRIC';

export interface DriverSignatureDto {
  method:          SignatureMethod;
  blob:            string; // PIN hashé | dataURL dessin | jeton biométrique opaque
  acknowledgedById: string; // User.id du chauffeur signataire
}

export interface CoPilotSignatureDto {
  staffId:    string;
  signedAt?:  Date; // défaut = maintenant
}

export interface CreateBriefingV2Dto {
  assignmentId:   string;
  templateId?:    string;  // défaut = template par défaut actif du tenant
  conductedById:  string;  // Staff.id du briefeur
  items:          CheckedItemV2Dto[];
  driverSignature: DriverSignatureDto;
  coPilotSignature?: CoPilotSignatureDto;
  briefingNotes?:  string;
  gpsLat?:         number;
  gpsLng?:         number;
  /** Si le tenant applique BLOCK_DEPARTURE et qu'un mandatory est KO,
   *  le manager peut fournir une justification pour overrider. */
  overrideReason?: string;
  overriddenById?: string;
}

export interface BriefingSignResult {
  briefingId:      string;
  anomaliesCount:  number;
  blocked:         boolean;       // true si tenant BLOCK_DEPARTURE et pas d'override
  alertsEmitted:   string[];      // codes des alertes sécurité émises
  restHoursSnapshot: number | null;
  allEquipmentOk:  boolean;       // alias rétro-compat
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class CrewBriefingService {
  private readonly logger = new Logger(CrewBriefingService.name);

  constructor(
    private readonly prisma:        PrismaService,
    private readonly restCalculator: DriverRestCalculatorService,
    private readonly alertService:  TripSafetyAlertService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════
  // LEGACY API v1 — Equipment Types (conservée pour rétro-compat)
  // Migration : BriefingItem kind=QUANTITY remplace ce modèle. L'UI admin
  // Sprint 4 pilote désormais via BriefingTemplateService.
  // ═══════════════════════════════════════════════════════════════════════

  async createEquipmentType(tenantId: string, dto: {
    name: string; code: string; requiredQty?: number; isMandatory?: boolean;
  }) {
    return this.prisma.briefingEquipmentType.create({
      data: {
        tenantId,
        name:        dto.name,
        code:        dto.code.toUpperCase(),
        requiredQty: dto.requiredQty ?? 1,
        isMandatory: dto.isMandatory ?? true,
      },
    });
  }

  async listEquipmentTypes(tenantId: string) {
    return this.prisma.briefingEquipmentType.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async updateEquipmentType(tenantId: string, id: string, dto: {
    name?: string; requiredQty?: number; isMandatory?: boolean; isActive?: boolean;
  }) {
    const eq = await this.prisma.briefingEquipmentType.findFirst({ where: { id, tenantId } });
    if (!eq) throw new NotFoundException(`Équipement ${id} introuvable`);
    return this.prisma.briefingEquipmentType.update({ where: { id }, data: dto });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API v1 — createBriefing (legacy, consommé par ancien flight-deck mobile)
  // Transforme l'input legacy en appel v2 via un pseudo-template "legacy".
  // ═══════════════════════════════════════════════════════════════════════

  async createBriefing(tenantId: string, dto: CreateBriefingDto, scope?: ScopeContext) {
    if (scope?.scope === 'own' && dto.conductedById !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — conductedById ≠ actor.id`);
    }

    const resolvedAssignmentId = await this.resolveOrCreateAssignment(
      tenantId, dto.assignmentId, dto.conductedById,
    );

    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { id: resolvedAssignmentId, tenantId },
    });
    if (!assignment) throw new NotFoundException(`Assignment ${resolvedAssignmentId} introuvable`);

    const existing = await this.prisma.crewBriefingRecord.findFirst({
      where: { assignmentId: resolvedAssignmentId },
    });
    if (existing) throw new BadRequestException('Un briefing existe déjà pour cette assignment');

    const mandatoryTypes = await this.prisma.briefingEquipmentType.findMany({
      where: { tenantId, isMandatory: true, isActive: true },
    });

    const checkedMap = new Map(dto.checkedItems.map(i => [i.equipmentTypeId, i]));
    const missing: string[] = [];
    for (const eq of mandatoryTypes) {
      const c = checkedMap.get(eq.id);
      if (!c || !c.ok || c.qty < eq.requiredQty) missing.push(eq.code);
    }
    const allEquipmentOk = missing.length === 0;

    const record = await this.prisma.crewBriefingRecord.create({
      data: {
        tenantId,
        assignmentId:  resolvedAssignmentId,
        conductedById: dto.conductedById,
        checkedItems:  dto.checkedItems as object[],
        allEquipmentOk,
        briefingNotes: dto.briefingNotes,
        gpsLat:        dto.gpsLat,
        gpsLng:        dto.gpsLng,
        completedAt:   new Date(),
        anomaliesCount: missing.length,
      },
    });

    const eventType = allEquipmentOk
      ? EventTypes.CREW_BRIEFING_COMPLETED
      : EventTypes.CREW_BRIEFING_EQUIPMENT_MISSING;

    await this._publishEvent(tenantId, resolvedAssignmentId, 'CrewAssignment', eventType, {
      briefingId:    record.id,
      conductedById: dto.conductedById,
      allEquipmentOk,
      missingCodes:  missing,
    });

    return { ...record, missingEquipmentCodes: missing };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // API v2 — createBriefingV2 (template-driven, multi-chapitres, double sig)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Signe un briefing multi-chapitres avec double signature + items
   * auto-calculés + politique tenant (WARN / ALERT / BLOCK).
   *
   * Règles :
   *   - scope='own' → conductedById doit correspondre à l'acteur.
   *   - Un seul briefing par CrewAssignment.
   *   - Template par défaut si `templateId` absent.
   *   - Items kind=INFO : autoValue recalculé serveur (source de vérité) — la
   *     valeur client est ignorée sauf pour debug.
   *   - Items mandatory KO → alerte TripSafetyAlert et anomalies++.
   *   - Tenant `mandatoryItemFailurePolicy='BLOCK_DEPARTURE'` + anomalies>0
   *     sans override → ForbiddenException (blocage).
   */
  async createBriefingV2(
    tenantId: string,
    dto:      CreateBriefingV2Dto,
    scope?:   ScopeContext,
  ): Promise<BriefingSignResult> {
    if (scope?.scope === 'own' && dto.conductedById !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — conductedById ≠ actor.id`);
    }

    const resolvedAssignmentId = await this.resolveOrCreateAssignment(
      tenantId, dto.assignmentId, dto.conductedById,
    );

    const assignment = await this.prisma.crewAssignment.findFirst({
      where:   { id: resolvedAssignmentId, tenantId },
      include: {
        trip: {
          select: {
            id:             true,
            driverId:       true,
            status:         true,
            departureScheduled: true,
            route:          { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!assignment) throw new NotFoundException(`Assignment ${resolvedAssignmentId} introuvable`);

    const existing = await this.prisma.crewBriefingRecord.findFirst({
      where: { assignmentId: resolvedAssignmentId },
    });
    if (existing) throw new BadRequestException('Un briefing existe déjà pour cette assignment');

    // Résolution du template (explicite ou défaut)
    const template = dto.templateId
      ? await this.prisma.briefingTemplate.findFirst({
          where:   { id: dto.templateId, tenantId, isActive: true },
          include: {
            sections: {
              where:   { isActive: true },
              include: { items: { where: { isActive: true } } },
            },
          },
        })
      : await this.prisma.briefingTemplate.findFirst({
          where:   { tenantId, isDefault: true, isActive: true },
          include: {
            sections: {
              where:   { isActive: true },
              include: { items: { where: { isActive: true } } },
            },
          },
        });

    if (!template) {
      throw new BadRequestException(
        'Aucun template de briefing actif pour ce tenant. Seeder briefing-template.seed.ts.',
      );
    }

    // Flatten items actifs, indexés par id
    const activeItems = template.sections.flatMap(s => s.items);
    const itemMap = new Map(activeItems.map(i => [i.id, i]));

    // ── Calcul valeurs auto (kind=INFO) ─────────────────────────────────────
    const restAssessment = await this.restCalculator.assess(
      tenantId,
      assignment.staffId,
      new Date(),
    );

    const manifestLoaded = await this._hasManifest(tenantId, assignment.tripId);
    const routeConfirmed = Boolean(assignment.trip?.route?.id);

    const autoValues: Record<string, boolean> = {
      DRIVER_REST_HOURS: restAssessment.compliant,
      MANIFEST_LOADED:   manifestLoaded,
      ROUTE_CONFIRMED:   routeConfirmed,
      WEATHER:           true, // placeholder : intégration météo future
    };

    // ── Validation input + calcul anomalies ────────────────────────────────
    const checkedById = new Map(dto.items.map(i => [i.itemId, i]));

    const anomalies: Array<{ code: string; labelFr: string; kind: ItemKind }> = [];
    const snapshot: Array<Record<string, unknown>> = [];

    for (const item of activeItems) {
      const checked = checkedById.get(item.id);

      let passed: boolean;
      let qty: number | undefined;

      if (item.kind === 'INFO' && item.autoSource) {
        // Valeur auto-calculée — la source serveur fait foi
        passed = autoValues[item.autoSource] ?? false;
      } else if (item.kind === 'QUANTITY') {
        qty = checked?.qty ?? 0;
        passed = Boolean(checked?.passed) && qty >= item.requiredQty;
      } else {
        passed = Boolean(checked?.passed);
      }

      snapshot.push({
        itemId:       item.id,
        code:         item.code,
        kind:         item.kind,
        passed,
        qty,
        notes:        checked?.notes,
        evidenceKeys: checked?.evidenceKeys ?? [],
        autoValue:    item.kind === 'INFO' && item.autoSource
          ? autoValues[item.autoSource]
          : undefined,
      });

      if (!passed && item.isMandatory) {
        anomalies.push({ code: item.code, labelFr: item.labelFr, kind: item.kind as ItemKind });
      }
    }

    // ── Politique tenant : BLOCK_DEPARTURE ? ────────────────────────────────
    const config = await this.prisma.tenantBusinessConfig.findUnique({
      where:  { tenantId },
      select: {
        preTripBriefingPolicy:      true,
        mandatoryItemFailurePolicy: true,
        restShortfallPolicy:        true,
      },
    });

    const failurePolicy = config?.mandatoryItemFailurePolicy ?? 'WARN_ONLY';
    const restPolicy    = config?.restShortfallPolicy        ?? 'WARN';

    const wouldBlockOnMandatory = failurePolicy === 'BLOCK_DEPARTURE' && anomalies.length > 0;
    const wouldBlockOnRest      = restPolicy    === 'BLOCK' && !restAssessment.compliant;
    const wouldBlock = wouldBlockOnMandatory || wouldBlockOnRest;
    const hasOverride = Boolean(dto.overrideReason && dto.overriddenById);

    if (wouldBlock && !hasOverride) {
      throw new ForbiddenException(
        `Politique tenant bloquante : ${wouldBlockOnMandatory ? 'item(s) obligatoire(s) KO' : 'repos conducteur insuffisant'}. Override manager requis avec justification.`,
      );
    }

    // ── Écriture du record ─────────────────────────────────────────────────
    const record = await this.prisma.crewBriefingRecord.create({
      data: {
        tenantId,
        assignmentId:           resolvedAssignmentId,
        conductedById:          dto.conductedById,
        templateId:             template.id,
        checkedItems:           snapshot as object[],
        allEquipmentOk:         anomalies.length === 0,
        anomaliesCount:         anomalies.length,
        briefingNotes:          dto.briefingNotes ?? null,
        gpsLat:                 dto.gpsLat ?? null,
        gpsLng:                 dto.gpsLng ?? null,
        restHoursSnapshot:      Number.isFinite(restAssessment.restHours) ? restAssessment.restHours : null,
        acknowledgedByDriverId: dto.driverSignature.acknowledgedById,
        driverSignedAt:         new Date(),
        driverSignatureMethod:  dto.driverSignature.method,
        driverSignatureBlob:    dto.driverSignature.blob,
        coPilotSignedById:      dto.coPilotSignature?.staffId ?? null,
        coPilotSignedAt:        dto.coPilotSignature?.staffId
          ? (dto.coPilotSignature.signedAt ?? new Date())
          : null,
        overrideReason:         hasOverride ? dto.overrideReason : null,
        overriddenById:         hasOverride ? dto.overriddenById : null,
        overriddenAt:           hasOverride ? new Date() : null,
        completedAt:            new Date(),
      },
    });

    // ── Mise à jour du CrewAssignment ──────────────────────────────────────
    await this.prisma.crewAssignment.update({
      where: { id: resolvedAssignmentId },
      data: {
        briefedAt: new Date(),
        ...(hasOverride ? {
          briefingOverrideById:   dto.overriddenById!,
          briefingOverrideReason: dto.overrideReason!,
          briefingOverrideAt:     new Date(),
        } : {}),
      },
    });

    // ── Alertes sécurité ───────────────────────────────────────────────────
    const alertsEmitted: string[] = [];

    for (const anomaly of anomalies) {
      const shouldEmit = failurePolicy !== 'WARN_ONLY'
                      || config?.preTripBriefingPolicy === 'RECOMMENDED_WITH_ALERT';
      if (!shouldEmit) continue;

      const severity: SafetyAlertSeverity = failurePolicy === 'BLOCK_DEPARTURE'
        ? 'CRITICAL'
        : 'WARNING';

      await this.alertService.raise(tenantId, {
        tripId:   assignment.tripId,
        severity,
        source:   'BRIEFING',
        code:     'MANDATORY_ITEM_FAILED',
        payload:  {
          briefingId:   record.id,
          itemCode:     anomaly.code,
          itemLabel:    anomaly.labelFr,
          itemKind:     anomaly.kind,
        },
      });
      alertsEmitted.push(anomaly.code);
    }

    if (!restAssessment.compliant && restPolicy !== 'WARN') {
      const severity: SafetyAlertSeverity = restPolicy === 'BLOCK' ? 'CRITICAL' : 'WARNING';
      await this.alertService.raise(tenantId, {
        tripId:   assignment.tripId,
        severity,
        source:   'BRIEFING',
        code:     'DRIVER_REST_SHORTFALL',
        payload:  {
          briefingId:      record.id,
          driverId:        assignment.staffId,
          restHours:       restAssessment.restHours,
          thresholdHours:  restAssessment.thresholdHours,
          shortfallHours:  restAssessment.shortfallHours,
          lastTripEndedAt: restAssessment.lastTripEndedAt?.toISOString() ?? null,
        },
      });
      alertsEmitted.push('DRIVER_REST_SHORTFALL');
    }

    // ── Événements domain ──────────────────────────────────────────────────
    await this._publishEvent(tenantId, record.id, 'CrewBriefingRecord', EventTypes.BRIEFING_SIGNED, {
      assignmentId:   resolvedAssignmentId,
      templateId:     template.id,
      conductedById:  dto.conductedById,
      acknowledgedByDriverId: dto.driverSignature.acknowledgedById,
      anomaliesCount: anomalies.length,
      restCompliant:  restAssessment.compliant,
      tripId:         assignment.tripId,
    });

    if (hasOverride) {
      await this._publishEvent(
        tenantId,
        record.id,
        'CrewBriefingRecord',
        EventTypes.BRIEFING_OVERRIDE_APPLIED,
        {
          assignmentId:  resolvedAssignmentId,
          tripId:        assignment.tripId,
          overriddenById: dto.overriddenById!,
          reason:        dto.overrideReason!,
          anomalyCodes:  anomalies.map(a => a.code),
        },
      );
    }

    return {
      briefingId:      record.id,
      anomaliesCount:  anomalies.length,
      blocked:         false, // on ne retourne `true` que lors du throw, ici c'est signé OK
      alertsEmitted,
      restHoursSnapshot: Number.isFinite(restAssessment.restHours) ? restAssessment.restHours : null,
      allEquipmentOk:  anomalies.length === 0,
    };
  }

  // ── Lectures ─────────────────────────────────────────────────────────────

  async getBriefingForAssignment(tenantId: string, assignmentId: string) {
    const record = await this.prisma.crewBriefingRecord.findFirst({
      where: { assignmentId, tenantId },
    });
    if (!record) throw new NotFoundException(`Briefing pour assignment ${assignmentId} introuvable`);
    return record;
  }

  async getBriefingHistory(tenantId: string, limit = 50) {
    return this.prisma.crewBriefingRecord.findMany({
      where:   { tenantId },
      orderBy: { completedAt: 'desc' },
      take:    limit,
    });
  }

  async getIncompleteBriefings(tenantId: string) {
    return this.prisma.crewBriefingRecord.findMany({
      where:   { tenantId, anomaliesCount: { gt: 0 } },
      orderBy: { completedAt: 'desc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Helpers privés
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Résout les IDs synthétiques "driver-<tripId>" en CrewAssignment réel.
   * (Conservé du v1 — pattern produit par `CrewService.getMineUpcoming`.)
   */
  private async resolveOrCreateAssignment(
    tenantId:        string,
    rawAssignmentId: string,
    conductedById:   string,
  ): Promise<string> {
    const SYNTHETIC_PREFIX = 'driver-';
    if (!rawAssignmentId.startsWith(SYNTHETIC_PREFIX)) return rawAssignmentId;

    const tripId = rawAssignmentId.slice(SYNTHETIC_PREFIX.length);
    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { id: true, driverId: true },
    });
    if (!trip) throw new NotFoundException(`Trip ${tripId} introuvable pour ce tenant`);

    const conductingStaff = await this.prisma.staff.findFirst({
      where:  { userId: conductedById, tenantId },
      select: { id: true },
    });
    if (!conductingStaff) {
      throw new NotFoundException(`Staff introuvable pour l'utilisateur ${conductedById}`);
    }
    if (conductingStaff.id !== trip.driverId) {
      throw new ForbiddenException(
        'Seul le chauffeur principal assigné au trajet peut créer ce briefing',
      );
    }

    const assignment = await this.prisma.crewAssignment.upsert({
      where:  { tripId_staffId: { tripId, staffId: conductingStaff.id } },
      update: {},
      create: {
        tenantId,
        tripId,
        staffId:  conductingStaff.id,
        crewRole: 'DRIVER',
      },
    });
    return assignment.id;
  }

  private async _hasManifest(tenantId: string, tripId: string): Promise<boolean> {
    const c = await this.prisma.manifest.count({
      where: { tenantId, tripId, status: { in: ['LOADED', 'PUBLISHED', 'CLOSED'] } },
    });
    return c > 0;
  }

  private async _publishEvent(
    tenantId:      string,
    aggregateId:   string,
    aggregateType: string,
    type:          string,
    payload:       Record<string, unknown>,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type,
      tenantId,
      aggregateId,
      aggregateType,
      payload,
      occurredAt:    new Date(),
    };
    await this.prisma.transact(tx => this.eventBus.publish(event, tx));
  }
}
