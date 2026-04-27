import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { StaffProvisioningService } from './staff-provisioning.service';

/**
 * StaffAssignmentService — gestion des postes occupés par un Staff.
 *
 * Voir DESIGN_Staff_Assignment.md §4 (modèle), §5 (invariants), §6 (Phase 3).
 *
 * Couverture (3 cas, voir §4.3) :
 *   agencyId renseigné, pas de coverageAgencies → MONO
 *   agencyId null,      pas de coverageAgencies → TENANT-WIDE
 *   agencyId null,      N coverageAgencies      → MULTI-SPÉCIFIQUE
 * Combinaison interdite : agencyId renseigné + coverageAgencies (rejetée).
 */
export interface CreateAssignmentDto {
  role:        string;
  agencyId?:   string | null;
  coverageAgencyIds?: string[];   // pour le cas multi-spécifique (agencyId doit être null)
  licenseData?: Record<string, unknown>;
  startDate?:  string;            // ISO ; défaut now() côté DB
}

export interface UpdateAssignmentDto {
  role?:        string;
  agencyId?:    string | null;
  licenseData?: Record<string, unknown>;
  isAvailable?: boolean;
}

@Injectable()
export class StaffAssignmentService {
  private readonly logger = new Logger(StaffAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional pour rétrocompatibilité avec les tests qui instancient le service
    // sans le helper. En prod, StaffProvisioningService est toujours injecté
    // via le module (cf. staff.module.ts).
    @Optional() private readonly provisioning?: StaffProvisioningService,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findStaffByUserId(tenantId: string, userId: string) {
    const staff = await this.prisma.staff.findFirst({ where: { tenantId, userId } });
    if (!staff) throw new NotFoundException(`Staff (userId=${userId}) introuvable`);
    return staff;
  }

  private async findAssignment(tenantId: string, assignmentId: string) {
    const a = await this.prisma.staffAssignment.findFirst({
      where:   { id: assignmentId, staff: { tenantId } },
      include: { coverageAgencies: { select: { agencyId: true } } },
    });
    if (!a) throw new NotFoundException(`Affectation ${assignmentId} introuvable`);
    return a;
  }

  /** Valide qu'une agence appartient bien au tenant — évite FK violation → 500. */
  private async assertAgencyInTenant(tenantId: string, agencyId: string) {
    const agency = await this.prisma.agency.findFirst({ where: { id: agencyId, tenantId } });
    if (!agency) throw new BadRequestException(`Agence ${agencyId} introuvable dans ce tenant`);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: CreateAssignmentDto) {
    const staff = await this.findStaffByUserId(tenantId, userId);

    const agencyId = dto.agencyId && dto.agencyId.trim() !== '' ? dto.agencyId : null;
    const coverageIds = dto.coverageAgencyIds ?? [];

    // Validation §4.3 : combinaison interdite
    if (agencyId && coverageIds.length > 0) {
      throw new BadRequestException(
        'agencyId et coverageAgencyIds sont mutuellement exclusifs (voir DESIGN §4.3)',
      );
    }

    // Validation FK : toutes les agences doivent appartenir au tenant
    if (agencyId) await this.assertAgencyInTenant(tenantId, agencyId);
    for (const id of coverageIds) {
      await this.assertAgencyInTenant(tenantId, id);
    }

    // Invariant §5.5 : pas de doublon (staffId, role, agencyId) actif
    const duplicate = await this.prisma.staffAssignment.findFirst({
      where: { staffId: staff.id, role: dto.role, agencyId, status: 'ACTIVE' },
    });
    if (duplicate) {
      throw new BadRequestException(
        `Une affectation ACTIVE existe déjà pour ce staff sur ce rôle et cette agence`,
      );
    }

    const created = await this.prisma.staffAssignment.create({
      data: {
        staffId:     staff.id,
        role:        dto.role,
        agencyId,
        startDate:   dto.startDate ? new Date(dto.startDate) : undefined,
        licenseData: (dto.licenseData ?? {}) as any,
        coverageAgencies: coverageIds.length > 0
          ? { create: coverageIds.map(id => ({ agencyId: id })) }
          : undefined,
      },
      include: { coverageAgencies: { select: { agencyId: true } } },
    });

    // Sync forward : si ce nouvel assignment devient le primary, aligner
    // User.roleId pour que IAM reflète le rôle métier.
    if (this.provisioning) {
      try {
        await this.provisioning.syncFromAssignment(created.id);
      } catch (err) {
        this.logger.warn(`syncFromAssignment failed for ${created.id}: ${(err as Error).message}`);
      }
    }

    return created;
  }

  async listForStaff(tenantId: string, userId: string) {
    const staff = await this.findStaffByUserId(tenantId, userId);
    return this.prisma.staffAssignment.findMany({
      where:   { staffId: staff.id },
      include: {
        agency:           { select: { id: true, name: true } },
        coverageAgencies: { include: { agency: { select: { id: true, name: true } } } },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
  }

  /**
   * Liste les affectations du tenant. Si `agencyId` est fourni, retourne celles
   * visibles depuis cette agence (mono + tenant-wide + multi-spécifique
   * incluant cette agence). Voir §4.3.
   */
  async list(tenantId: string, opts: { role?: string; agencyId?: string; status?: string }) {
    const status = opts.status ?? 'ACTIVE';

    return this.prisma.staffAssignment.findMany({
      where: {
        staff: { tenantId },
        status,
        ...(opts.role ? { role: opts.role } : {}),
        ...(opts.agencyId ? {
          OR: [
            { agencyId: opts.agencyId },                                                 // mono
            { agencyId: null, coverageAgencies: { none: {} } },                          // tenant-wide
            { agencyId: null, coverageAgencies: { some: { agencyId: opts.agencyId } } }, // multi-spécifique
          ],
        } : {}),
      },
      include: {
        staff:            { include: { user: { select: { id: true, email: true, name: true } } } },
        agency:           { select: { id: true, name: true } },
        coverageAgencies: { include: { agency: { select: { id: true, name: true } } } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async update(tenantId: string, assignmentId: string, dto: UpdateAssignmentDto) {
    const current = await this.findAssignment(tenantId, assignmentId);

    if (current.status === 'CLOSED') {
      throw new BadRequestException('Affectation clôturée — non modifiable');
    }

    if (dto.agencyId !== undefined && dto.agencyId !== null && dto.agencyId !== '') {
      await this.assertAgencyInTenant(tenantId, dto.agencyId);
      // Si on bascule en mono-agence, on doit purger d'éventuelles coverageAgencies
      if (current.coverageAgencies.length > 0) {
        await this.prisma.staffAssignmentAgency.deleteMany({ where: { assignmentId } });
      }
    }

    const updated = await this.prisma.staffAssignment.update({
      where: { id: assignmentId },
      data:  {
        ...(dto.role        !== undefined ? { role:        dto.role }                     : {}),
        ...(dto.agencyId    !== undefined ? { agencyId:    dto.agencyId || null }         : {}),
        ...(dto.licenseData !== undefined ? { licenseData: dto.licenseData as any }       : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable }              : {}),
      },
      include: { coverageAgencies: { select: { agencyId: true } } },
    });

    // Sync forward : si .role a changé et que cet assignment est le primary,
    // aligner User.roleId pour préserver l'invariant.
    if (dto.role !== undefined && this.provisioning) {
      try {
        await this.provisioning.syncFromAssignment(assignmentId);
      } catch (err) {
        this.logger.warn(`syncFromAssignment failed for ${assignmentId}: ${(err as Error).message}`);
      }
    }

    return updated;
  }

  async close(tenantId: string, assignmentId: string) {
    const current = await this.findAssignment(tenantId, assignmentId);
    if (current.status === 'CLOSED') return current;
    return this.prisma.staffAssignment.update({
      where: { id: assignmentId },
      data:  { status: 'CLOSED', endDate: new Date(), isAvailable: false },
    });
  }

  // ─── Multi-agences spécifiques (sous-ressource) ──────────────────────────

  async addCoverageAgency(tenantId: string, assignmentId: string, agencyId: string) {
    const current = await this.findAssignment(tenantId, assignmentId);
    if (current.agencyId) {
      throw new BadRequestException(
        'Cette affectation est mono-agence (agencyId renseigné). Bascule en tenant-wide ou multi avant.',
      );
    }
    await this.assertAgencyInTenant(tenantId, agencyId);
    // Idempotent : si déjà présent, ne rien faire
    return this.prisma.staffAssignmentAgency.upsert({
      where:  { assignmentId_agencyId: { assignmentId, agencyId } },
      create: { assignmentId, agencyId },
      update: {},
    });
  }

  async removeCoverageAgency(tenantId: string, assignmentId: string, agencyId: string) {
    await this.findAssignment(tenantId, assignmentId);
    const deleted = await this.prisma.staffAssignmentAgency.deleteMany({
      where: { assignmentId, agencyId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException(`Agence ${agencyId} non couverte par cette affectation`);
    }
    return { removed: true };
  }
}
