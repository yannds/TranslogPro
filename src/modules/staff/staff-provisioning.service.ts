import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * StaffProvisioningService — helper unique de réconciliation User staff ↔ Staff ↔ StaffAssignment.
 *
 * Invariants garantis :
 *   1. Tout User(userType='STAFF') doit avoir une row Staff (1-1) et un StaffAssignment ACTIVE primaire.
 *   2. Le name du Role IAM (User.role.name) === StaffAssignment.role du primary, en permanence.
 *   3. Roles externes (CUSTOMER, PUBLIC_REPORTER) ne sont jamais provisionnés en Staff.
 *
 * Idempotence : ensureStaffForUser() peut être appelé N fois ; le résultat converge.
 *
 * Voir docs/STAFF_RBAC_SYNC.md.
 */
@Injectable()
export class StaffProvisioningService {
  private readonly logger = new Logger(StaffProvisioningService.name);

  /** Roles externes : ne donnent jamais lieu à un Staff. */
  static readonly EXTERNAL_ROLES = new Set(['CUSTOMER', 'PUBLIC_REPORTER']);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée ou réconcilie Staff + StaffAssignment ACTIVE primaire pour un User staff,
   * et aligne User.roleId sur le Role tenant dont name === role.
   *
   * @param userId      User cible (doit exister, userType='STAFF', tenantId match).
   * @param tenantId    Tenant scope.
   * @param role        Optionnel — si absent, déduit du User.role.name actuel.
   *                    Si fourni, écrase le User.roleId pour pointer vers Role(name=role).
   * @param agencyId    Optionnel — agence du Staff + de l'assignment primaire.
   *                    Si absent, prend User.agencyId.
   *
   * @returns Staff + primary assignment + flag `created` (true si Staff vient d'être créé).
   *
   * Refuse :
   *   - userType !== 'STAFF' → BadRequest
   *   - role externe (CUSTOMER, PUBLIC_REPORTER) → BadRequest
   *   - Role(name=role) introuvable dans le tenant → NotFound
   */
  async ensureStaffForUser(opts: {
    userId:    string;
    tenantId:  string;
    role?:     string;
    agencyId?: string | null;
  }): Promise<{ staffId: string; assignmentId: string; role: string; created: boolean }> {
    const { userId, tenantId } = opts;

    const user = await this.prisma.user.findFirst({
      where:   { id: userId, tenantId },
      include: { role: { select: { id: true, name: true } }, staffProfile: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} introuvable dans le tenant ${tenantId}`);
    if (user.userType !== 'STAFF') {
      throw new BadRequestException(
        `User ${userId} a userType='${user.userType}' — provisioning Staff réservé à userType='STAFF'`,
      );
    }

    // Détermination du rôle cible.
    const targetRole = opts.role ?? user.role?.name;
    if (!targetRole) {
      throw new BadRequestException(
        `Aucun rôle cible : User ${userId} n'a pas de Role IAM et aucun rôle n'a été fourni`,
      );
    }
    if (StaffProvisioningService.EXTERNAL_ROLES.has(targetRole)) {
      throw new BadRequestException(
        `Rôle '${targetRole}' externe — non provisionnable en Staff`,
      );
    }

    // Le Role IAM cible doit exister dans le tenant (système ou custom).
    const iamRole = await this.prisma.role.findFirst({
      where:  { tenantId, name: targetRole },
      select: { id: true, name: true },
    });
    if (!iamRole) {
      throw new NotFoundException(
        `Role '${targetRole}' introuvable dans le tenant ${tenantId} (créer le Role avant de provisionner)`,
      );
    }

    const targetAgencyId = opts.agencyId !== undefined ? opts.agencyId : user.agencyId;

    // Aligner User.roleId si désaligné.
    if (user.roleId !== iamRole.id) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { roleId: iamRole.id },
      });
    }

    // Cas 1 : Staff inexistant → création complète.
    if (!user.staffProfile) {
      const staff = await this.prisma.staff.create({
        data: { userId, tenantId, agencyId: targetAgencyId, status: 'ACTIVE' },
      });
      const assignment = await this.prisma.staffAssignment.create({
        data: {
          staffId:  staff.id,
          role:     targetRole,
          agencyId: targetAgencyId,
          status:   'ACTIVE',
        },
      });
      this.logger.log(`Staff provisionné : userId=${userId} role=${targetRole} agencyId=${targetAgencyId ?? 'tenant-wide'}`);
      return { staffId: staff.id, assignmentId: assignment.id, role: targetRole, created: true };
    }

    // Cas 2 : Staff existe → réconcilier le primary assignment.
    const staff = user.staffProfile;
    const primary = await this.getPrimaryAssignment(staff.id);

    if (!primary) {
      // Staff sans assignment ACTIVE → en créer un.
      const assignment = await this.prisma.staffAssignment.create({
        data: {
          staffId:  staff.id,
          role:     targetRole,
          agencyId: targetAgencyId,
          status:   'ACTIVE',
        },
      });
      return { staffId: staff.id, assignmentId: assignment.id, role: targetRole, created: false };
    }

    // Primary existe → mettre à jour role/agency si désaligné.
    const needsUpdate =
      primary.role !== targetRole ||
      (opts.agencyId !== undefined && primary.agencyId !== targetAgencyId);

    if (needsUpdate) {
      await this.prisma.staffAssignment.update({
        where: { id: primary.id },
        data:  {
          role:     targetRole,
          agencyId: opts.agencyId !== undefined ? targetAgencyId : primary.agencyId,
        },
      });
    }

    return { staffId: staff.id, assignmentId: primary.id, role: targetRole, created: false };
  }

  /**
   * Sync IAM ← Assignment : après mutation d'un StaffAssignment (.role changé),
   * met à jour User.roleId pour pointer vers Role(name=assignment.role).
   * No-op si l'assignment n'est pas le primary du Staff.
   * Warning silencieux si le Role tenant n'existe pas (custom non encore créé).
   */
  async syncFromAssignment(assignmentId: string): Promise<void> {
    const assignment = await this.prisma.staffAssignment.findFirst({
      where:   { id: assignmentId },
      include: { staff: { select: { id: true, userId: true, tenantId: true } } },
    });
    if (!assignment) return;
    if (assignment.status !== 'ACTIVE') return;

    const primary = await this.getPrimaryAssignment(assignment.staff.id);
    if (!primary || primary.id !== assignmentId) return;

    const iamRole = await this.prisma.role.findFirst({
      where:  { tenantId: assignment.staff.tenantId, name: assignment.role },
      select: { id: true },
    });
    if (!iamRole) {
      this.logger.warn(
        `syncFromAssignment: Role '${assignment.role}' introuvable dans tenant ${assignment.staff.tenantId} — User.roleId non mis à jour`,
      );
      return;
    }

    await this.prisma.user.update({
      where: { id: assignment.staff.userId },
      data:  { roleId: iamRole.id },
    });
  }

  /**
   * Sync Assignment ← IAM : après changement User.roleId, met à jour le primary
   * StaffAssignment.role pour refléter le nouveau Role.name.
   * No-op si User n'a pas de Staff ou pas de primary assignment.
   */
  async syncFromUserRole(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where:   { id: userId },
      include: { role: { select: { name: true } }, staffProfile: true },
    });
    if (!user) return;
    if (user.userType !== 'STAFF') return;
    if (!user.staffProfile) return;
    if (!user.role) return;
    if (StaffProvisioningService.EXTERNAL_ROLES.has(user.role.name)) return;

    const primary = await this.getPrimaryAssignment(user.staffProfile.id);
    if (!primary) return;
    if (primary.role === user.role.name) return;

    await this.prisma.staffAssignment.update({
      where: { id: primary.id },
      data:  { role: user.role.name },
    });
  }

  /**
   * Primary = StaffAssignment ACTIVE le plus récent (startDate desc).
   * Convention : 1 ACTIVE max par Staff (règle métier strict 1-1, voir docs/STAFF_RBAC_SYNC.md).
   * Si plusieurs ACTIVE existent (cas legacy), on retient le plus récent.
   */
  async getPrimaryAssignment(staffId: string) {
    return this.prisma.staffAssignment.findFirst({
      where:   { staffId, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
  }
}
