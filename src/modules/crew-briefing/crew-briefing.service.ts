/**
 * CrewBriefingService — Briefing pré-départ de l'équipage.
 *
 * Responsabilités :
 *   - Catalogue des équipements obligatoires par tenant (BriefingEquipmentType)
 *   - Création du CrewBriefingRecord pour un CrewAssignment (checklist équipements)
 *   - Calcul allEquipmentOk : true si tous les items isMandatory sont présents et OK
 *   - Publication d'événements CREW_BRIEFING_COMPLETED et CREW_BRIEFING_EQUIPMENT_MISSING
 *
 * Règle : la liste des équipements et les quantités requises viennent de la DB par tenant.
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
import {
  IEventBus,
  EVENT_BUS,
  DomainEvent,
} from '../../infrastructure/eventbus/interfaces/eventbus.interface';
import { EventTypes }          from '../../common/types/domain-event.type';
import { v4 as uuidv4 }        from 'uuid';

// ─── DTO ──────────────────────────────────────────────────────────────────────

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

@Injectable()
export class CrewBriefingService {
  private readonly logger = new Logger(CrewBriefingService.name);

  constructor(
    private readonly prisma:    PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: IEventBus,
  ) {}

  // ─── Equipment Types ──────────────────────────────────────────────────────

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

  // ─── Briefing Records ─────────────────────────────────────────────────────

  /**
   * Crée le briefing d'une assignment.
   * Calcule allEquipmentOk en vérifiant que tous les items isMandatory de ce tenant
   * sont présents dans checkedItems avec ok=true et qty >= requiredQty.
   */
  async createBriefing(tenantId: string, dto: CreateBriefingDto, scope?: ScopeContext) {
    // Scope own : un acteur ne peut conduire un briefing QUE pour lui-même
    if (scope?.scope === 'own' && dto.conductedById !== scope.userId) {
      throw new ForbiddenException(`Scope 'own' violation — conductedById ≠ actor.id`);
    }

    // Résolution d'assignment — accepte les IDs synthétiques "driver-<tripId>"
    // générés par CrewService.getMineUpcoming() pour les chauffeurs principaux
    // (Trip.driverId) n'ayant pas de CrewAssignment réel en DB. Dans ce cas,
    // on upsert le CrewAssignment à la volée avant de créer le briefing.
    const resolvedAssignmentId = await this.resolveOrCreateAssignment(
      tenantId, dto.assignmentId, dto.conductedById,
    );

    // Vérifier que l'assignment existe et appartient à ce tenant
    const assignment = await this.prisma.crewAssignment.findFirst({
      where: { id: resolvedAssignmentId, tenantId },
    });
    if (!assignment) throw new NotFoundException(`Assignment ${resolvedAssignmentId} introuvable`);

    // Un seul briefing par assignment
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
      const checked = checkedMap.get(eq.id);
      if (!checked || !checked.ok || checked.qty < eq.requiredQty) {
        missing.push(eq.code);
      }
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
      },
    });

    const eventType = allEquipmentOk
      ? EventTypes.CREW_BRIEFING_COMPLETED
      : EventTypes.CREW_BRIEFING_EQUIPMENT_MISSING;

    await this._publishBriefingEvent(tenantId, resolvedAssignmentId, eventType, {
      briefingId:    record.id,
      conductedById: dto.conductedById,
      allEquipmentOk,
      missingCodes:  missing,
    });

    return { ...record, missingEquipmentCodes: missing };
  }

  /**
   * Résout l'assignmentId envoyé par le frontend en un vrai CrewAssignment.id.
   *
   * Cas standard : l'ID est un cuid → on le retourne tel quel.
   *
   * Cas synthétique : l'ID commence par `driver-<tripId>` (pattern produit par
   * `CrewService.getMineUpcoming` pour les chauffeurs principaux sans
   * CrewAssignment réel). On vérifie que :
   *   - Le trip existe et appartient au tenant.
   *   - Le Staff du `conductedById` est bien le driver du trip (sécurité).
   * Puis on upsert un CrewAssignment(crewRole='DRIVER') et on retourne son id.
   *
   * Cette mise à niveau est idempotente — un second appel retombera sur le même
   * CrewAssignment et sera rejeté par le check "un briefing par assignment".
   */
  private async resolveOrCreateAssignment(
    tenantId:      string,
    rawAssignmentId: string,
    conductedById:   string,
  ): Promise<string> {
    const SYNTHETIC_PREFIX = 'driver-';
    if (!rawAssignmentId.startsWith(SYNTHETIC_PREFIX)) {
      return rawAssignmentId;
    }
    const tripId = rawAssignmentId.slice(SYNTHETIC_PREFIX.length);

    const trip = await this.prisma.trip.findFirst({
      where:  { id: tripId, tenantId },
      select: { id: true, driverId: true },
    });
    if (!trip) {
      throw new NotFoundException(`Trip ${tripId} introuvable pour ce tenant`);
    }

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

    // Upsert — idempotent sur (tripId, staffId)
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
      where:   { tenantId, allEquipmentOk: false },
      orderBy: { completedAt: 'desc' },
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async _publishBriefingEvent(
    tenantId:    string,
    assignmentId: string,
    type:        string,
    payload:     Record<string, unknown>,
  ) {
    const event: DomainEvent = {
      id:            uuidv4(),
      type,
      tenantId,
      aggregateId:   assignmentId,
      aggregateType: 'CrewAssignment',
      payload:       { assignmentId, ...payload },
      occurredAt:    new Date(),
    };
    await this.eventBus.publish(event, null);
  }
}
