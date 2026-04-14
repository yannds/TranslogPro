/**
 * SchedulingGuardService — Garde-fou avant toute affectation de trajet.
 *
 * Responsabilités :
 *   - Vérifier que le bus n'est pas en statut MAINTENANCE_REQUIRED ou OUT_OF_SERVICE
 *   - Vérifier que le bus a tous ses documents réglementaires valides (ou au moins non-EXPIRED)
 *   - Vérifier que le chauffeur a respecté son temps de repos minimum (via DriverRestConfig)
 *   - Vérifier que le chauffeur n'a pas de suspension active (DriverRemediationAction PENDING de type SUSPENSION)
 *   - Vérifier que le permis du chauffeur est valide (non EXPIRED ni SUSPENDED)
 *
 * Retourne un objet { canAssign: boolean, reasons: string[] } permettant
 * à l'appelant (TripController, CrewController, SchedulerService) de décider.
 * Ne lève jamais d'exception — le consommateur choisit de bloquer ou d'afficher un warning.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../../infrastructure/database/prisma.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssignabilityCheckResult {
  canAssign: boolean;
  reasons:   BlockReason[];
}

export interface BlockReason {
  code:    string;
  message: string;
  data?:   Record<string, unknown>;
}

// ─── Codes de blocage (libres, utilisés en frontend pour l18n) ───────────────

const BLOCK = {
  BUS_MAINTENANCE:       'BUS_MAINTENANCE',
  BUS_OUT_OF_SERVICE:    'BUS_OUT_OF_SERVICE',
  BUS_DOCUMENT_EXPIRED:  'BUS_DOCUMENT_EXPIRED',
  DRIVER_REST_REQUIRED:  'DRIVER_REST_REQUIRED',
  DRIVER_SUSPENDED:      'DRIVER_SUSPENDED',
  DRIVER_LICENSE_EXPIRED:'DRIVER_LICENSE_EXPIRED',
} as const;

@Injectable()
export class SchedulingGuardService {
  private readonly logger = new Logger(SchedulingGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vérifie si un bus et un chauffeur peuvent être affectés à un trajet.
   * @param tenantId  Tenant de l'opération
   * @param busId     Bus à affecter (peut être undefined si vérification driver only)
   * @param staffId   Chauffeur à affecter (peut être undefined si vérification bus only)
   */
  async checkAssignability(
    tenantId: string,
    busId?:   string,
    staffId?: string,
  ): Promise<AssignabilityCheckResult> {
    const reasons: BlockReason[] = [];

    if (busId) {
      const busReasons = await this._checkBus(tenantId, busId);
      reasons.push(...busReasons);
    }

    if (staffId) {
      const driverReasons = await this._checkDriver(tenantId, staffId);
      reasons.push(...driverReasons);
    }

    return { canAssign: reasons.length === 0, reasons };
  }

  // ─── Bus checks ───────────────────────────────────────────────────────────

  private async _checkBus(tenantId: string, busId: string): Promise<BlockReason[]> {
    const reasons: BlockReason[] = [];

    const bus = await this.prisma.bus.findFirst({
      where: { id: busId, tenantId },
    });

    if (!bus) {
      reasons.push({ code: BLOCK.BUS_OUT_OF_SERVICE, message: `Bus ${busId} introuvable` });
      return reasons;
    }

    if (bus.status === 'MAINTENANCE_REQUIRED') {
      reasons.push({
        code:    BLOCK.BUS_MAINTENANCE,
        message: `Bus ${bus.plateNumber} est en attente de maintenance`,
        data:    { busId, plateNumber: bus.plateNumber },
      });
    }

    if (bus.status === 'OUT_OF_SERVICE' || bus.status === 'RETIRED') {
      reasons.push({
        code:    BLOCK.BUS_OUT_OF_SERVICE,
        message: `Bus ${bus.plateNumber} est hors service (${bus.status})`,
        data:    { busId, status: bus.status },
      });
    }

    // Vérifier documents obligatoires non expirés
    const expiredMandatoryDocs = await this.prisma.vehicleDocument.findMany({
      where: {
        tenantId,
        busId,
        status: 'EXPIRED',
        type:   { isMandatory: true },
      },
      include: { type: true },
    });

    if (expiredMandatoryDocs.length > 0) {
      reasons.push({
        code:    BLOCK.BUS_DOCUMENT_EXPIRED,
        message: `Bus ${bus.plateNumber} a ${expiredMandatoryDocs.length} document(s) expiré(s) obligatoire(s)`,
        data: {
          busId,
          expiredDocuments: expiredMandatoryDocs.map(d => ({
            typeCode: d.type.code,
            name:     d.type.name,
            expiresAt: d.expiresAt,
          })),
        },
      });
    }

    return reasons;
  }

  // ─── Driver checks ────────────────────────────────────────────────────────

  private async _checkDriver(tenantId: string, staffId: string): Promise<BlockReason[]> {
    const reasons: BlockReason[] = [];

    // 1. Vérifier le repos minimum
    const restCheck = await this._checkDriverRest(tenantId, staffId);
    if (restCheck) reasons.push(restCheck);

    // 2. Vérifier les suspensions actives
    const suspensionCheck = await this._checkDriverSuspension(tenantId, staffId);
    if (suspensionCheck) reasons.push(suspensionCheck);

    // 3. Vérifier la validité des permis
    const licenseCheck = await this._checkDriverLicense(tenantId, staffId);
    if (licenseCheck) reasons.push(licenseCheck);

    return reasons;
  }

  private async _checkDriverRest(tenantId: string, staffId: string): Promise<BlockReason | null> {
    const config = await this.prisma.driverRestConfig.findUnique({ where: { tenantId } });
    if (!config) return null; // Pas de config = pas de blocage

    // Période de repos ouverte
    const active = await this.prisma.driverRestPeriod.findFirst({
      where:   { tenantId, staffId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    if (active) {
      const elapsedMin  = Math.floor((Date.now() - active.startedAt.getTime()) / 60_000);
      const remaining   = config.minRestMinutes - elapsedMin;

      if (remaining > 0) {
        return {
          code:    BLOCK.DRIVER_REST_REQUIRED,
          message: `Chauffeur en repos obligatoire — encore ${remaining} min`,
          data:    { staffId, restRemainingMinutes: remaining, restStartedAt: active.startedAt },
        };
      }
    }

    return null;
  }

  private async _checkDriverSuspension(tenantId: string, staffId: string): Promise<BlockReason | null> {
    const suspension = await this.prisma.driverRemediationAction.findFirst({
      where: {
        tenantId,
        staffId,
        status:   { in: ['PENDING', 'IN_PROGRESS'] },
        rule:     { actionType: 'SUSPENSION' },
      },
      include: { rule: true },
    });

    if (!suspension) return null;

    return {
      code:    BLOCK.DRIVER_SUSPENDED,
      message: `Chauffeur suspendu — action de remédiation en cours (${suspension.rule.name})`,
      data: {
        staffId,
        actionId:   suspension.id,
        reason:     suspension.rule.name,
        triggeredAt: suspension.triggeredAt,
        dueAt:       suspension.dueAt,
      },
    };
  }

  private async _checkDriverLicense(tenantId: string, staffId: string): Promise<BlockReason | null> {
    // Cherche un permis catégorie D ou EC (conduite de bus) valide
    const validLicense = await this.prisma.driverLicense.findFirst({
      where: {
        tenantId,
        staffId,
        category: { in: ['D', 'EC', 'D+E'] },
        status:   { in: ['VALID', 'EXPIRING'] },
      },
    });

    if (!validLicense) {
      // Vérifier s'il en a un mais expiré
      const expiredLicense = await this.prisma.driverLicense.findFirst({
        where: { tenantId, staffId, category: { in: ['D', 'EC', 'D+E'] } },
      });

      return {
        code:    BLOCK.DRIVER_LICENSE_EXPIRED,
        message: expiredLicense
          ? `Permis de conduire ${expiredLicense.category} expiré ou suspendu`
          : `Aucun permis de conduire bus (D/EC) enregistré`,
        data: { staffId, license: expiredLicense ?? null },
      };
    }

    return null;
  }
}
