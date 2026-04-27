import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IIdentityManager, IDENTITY_SERVICE } from '../../infrastructure/identity/interfaces/identity.interface';
import { Inject } from '@nestjs/common';
import { WorkflowEngine } from '../../core/workflow/workflow.engine';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { StaffProvisioningService } from './staff-provisioning.service';

const SYSTEM_ACTOR: CurrentUserPayload = {
  id:       'SYSTEM',
  tenantId: 'SYSTEM',
  roleId:   'SYSTEM',
} as CurrentUserPayload;

export interface CreateStaffDto {
  email:    string;
  name:     string;
  role:     string;                            // rôle métier de la 1ère affectation
  agencyId?: string | null;                    // home admin + agence de la 1ère affectation
  licenseData?: Record<string, unknown>;       // licence portée par la 1ère affectation
}

/**
 * Mapping rôle métier (StaffAssignment) → rôle IAM (User.roleId).
 * Sans ce mapping, un user créé via /admin/staff peut se loguer mais
 * n'accède à aucun portail (HomeRedirect ne sait pas où le router).
 * Fix E-IAM-1.
 */
const STAFF_ROLE_TO_IAM: Record<string, string> = {
  DRIVER:     'DRIVER',
  MECHANIC:   'MECHANIC',
  HOSTESS:    'DRIVER',           // hôtesse = membre d'équipage → perms driver (à défaut de rôle dédié)
  AGENT:      'AGENT_QUAI',       // agent opérationnel → portail /quai
  CONTROLLER: 'DISPATCHER',       // contrôleur / répartiteur
  SUPERVISOR: 'AGENCY_MANAGER',   // superviseur = manager d'agence
};

export interface UpdateStaffDto {
  name?:     string;
  agencyId?: string | null;                    // home admin
  /**
   * Rôle métier — si fourni, aligne via StaffProvisioningService :
   *   - Crée/met à jour le primary StaffAssignment(role=role)
   *   - Aligne User.roleId pour matcher Role(tenantId, name=role)
   * Doit correspondre à un Role.name existant dans le tenant.
   */
  role?:     string;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma:    PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IIdentityManager,
    private readonly workflow: WorkflowEngine,
    private readonly provisioning: StaffProvisioningService,
  ) {}

  async create(tenantId: string, dto: CreateStaffDto) {
    // Phase 1 multi-tenant : email unique par (tenantId, email), pas global.
    const existing = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId, email: dto.email } },
    });
    if (existing) throw new ConflictException(`Email ${dto.email} déjà enregistré dans ce tenant`);

    const agencyId = dto.agencyId && dto.agencyId.trim() !== '' ? dto.agencyId : null;

    // Valider que l'agence existe bien dans le tenant (évite FK violation → 500)
    if (agencyId) {
      const agency = await this.prisma.agency.findFirst({ where: { id: agencyId, tenantId } });
      if (!agency) throw new BadRequestException(`Agence ${agencyId} introuvable dans ce tenant`);
    }

    const user = await this.identity.createUser({
      email:    dto.email,
      password: this.generateTemporaryPassword(),
      name:     dto.name,
      tenantId,
      agencyId: agencyId ?? undefined,
      userType: 'STAFF',
    });

    // Fix E-IAM-1 : aligner le roleId IAM sur le rôle métier choisi à la création.
    // Sans ça, le user créé peut se loguer mais HomeRedirect ne sait pas
    // l'orienter vers son portail (driver/quai/agence/etc.) car roleId pointe
    // sur un rôle générique sans perms portail.
    const iamRoleName = STAFF_ROLE_TO_IAM[dto.role];
    if (iamRoleName) {
      const iamRole = await this.prisma.role.findFirst({
        where: { tenantId, name: iamRoleName },
      });
      if (iamRole) {
        await this.prisma.user.update({
          where: { id: user.id },
          data:  { roleId: iamRole.id },
        });
      }
    }

    // Phase 5 : Staff = enveloppe RH ; les colonnes legacy (role/license/dispo)
    // ont été supprimées. Le poste métier est porté par StaffAssignment.
    const staff = await this.prisma.staff.create({
      data: { userId: user.id, tenantId, agencyId, status: 'ACTIVE' },
    });
    await this.prisma.staffAssignment.create({
      data: {
        staffId:     staff.id,
        role:        dto.role,
        agencyId,
        status:      'ACTIVE',
        licenseData: (dto.licenseData ?? {}) as any,
      },
    });

    return user;
  }

  /**
   * Liste les Staffs du tenant. Si `role` est précisé, seuls les Staffs qui
   * ont au moins une StaffAssignment ACTIVE pour ce rôle sont retournés
   * (lecture via Phase 2 — voir DESIGN_Staff_Assignment.md §6).
   */
  async findAll(tenantId: string, agencyId?: string, role?: string) {
    return this.prisma.staff.findMany({
      where: {
        tenantId,
        ...(agencyId ? { agencyId } : {}),
        ...(role ? {
          assignments: {
            some: {
              role,
              status: 'ACTIVE',
              ...(agencyId ? { OR: [{ agencyId }, { agencyId: null }] } : {}),
            },
          },
        } : {}),
      },
      include: {
        user: {
          select: {
            id: true, email: true, name: true, roleId: true,
            role: { select: { name: true } },
          },
        },
        assignments: {
          where:  { status: 'ACTIVE' },
          select: {
            id: true, role: true, agencyId: true, status: true, isAvailable: true, startDate: true,
            agency:           { select: { id: true, name: true } },
            coverageAgencies: { select: { agency: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Liste les users du tenant éligibles à devenir Staff (pas de staffProfile).
   * Sert au dialog « Promouvoir un user IAM » de PagePersonnel (Phase 4).
   */
  async listEligibleUsers(tenantId: string) {
    return this.prisma.user.findMany({
      where:  { tenantId, userType: 'STAFF', staffProfile: null },
      select: {
        id: true, email: true, name: true, agencyId: true,
        agency: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Promeut un user IAM existant en Staff (crée Staff + 1ère StaffAssignment).
   * Le user doit appartenir au tenant et ne pas déjà avoir de staffProfile.
   */
  async promoteFromUser(tenantId: string, userId: string, dto: { role: string; agencyId?: string | null; licenseData?: Record<string, unknown> }) {
    const user = await this.prisma.user.findFirst({
      where:   { id: userId, tenantId },
      include: { staffProfile: true },
    });
    if (!user) throw new NotFoundException(`User ${userId} introuvable dans ce tenant`);
    if (user.staffProfile) throw new ConflictException(`User ${userId} a déjà un profil Staff`);

    const agencyId = dto.agencyId && dto.agencyId.trim() !== '' ? dto.agencyId : null;
    if (agencyId) {
      const agency = await this.prisma.agency.findFirst({ where: { id: agencyId, tenantId } });
      if (!agency) throw new BadRequestException(`Agence ${agencyId} introuvable dans ce tenant`);
    }

    const staff = await this.prisma.staff.create({
      data: { userId, tenantId, agencyId, status: 'ACTIVE' },
    });
    await this.prisma.staffAssignment.create({
      data: {
        staffId:     staff.id,
        role:        dto.role,
        agencyId,
        status:      'ACTIVE',
        licenseData: (dto.licenseData ?? {}) as any,
      },
    });

    return staff;
  }

  async findOne(tenantId: string, userId: string) {
    const staff = await this.prisma.staff.findFirst({
      where:   { userId, tenantId },
      include: { user: true },
    });
    if (!staff) throw new NotFoundException(`Staff ${userId} not found`);
    return staff;
  }

  /**
   * Met à jour le profil RH du Staff (name + agence de rattachement).
   * Les rôles, dispo et licences se gèrent via StaffAssignmentService.
   */
  async update(tenantId: string, userId: string, dto: UpdateStaffDto) {
    const staff = await this.findOne(tenantId, userId);

    if (dto.name !== undefined && dto.name !== staff.user.name) {
      await this.prisma.user.update({
        where: { id: userId },
        data:  { name: dto.name },
      });
    }

    const updated = await this.prisma.staff.update({
      where: { userId },
      data:  {
        ...(dto.agencyId !== undefined ? { agencyId: dto.agencyId ?? null } : {}),
      },
      include: { user: true },
    });

    // Si un nouveau rôle est demandé, le helper aligne primary StaffAssignment
    // + User.roleId. Refusera si le Role n'existe pas dans le tenant ou si
    // le rôle est externe (CUSTOMER, PUBLIC_REPORTER).
    if (dto.role !== undefined && dto.role !== '') {
      await this.provisioning.ensureStaffForUser({
        userId,
        tenantId,
        role:     dto.role,
        agencyId: dto.agencyId !== undefined ? (dto.agencyId ?? null) : updated.agencyId,
      });
    }

    return updated;
  }

  async suspend(tenantId: string, userId: string, actor?: CurrentUserPayload) {
    const staff = await this.findOne(tenantId, userId);
    await this.transitionStaffAndAssignments(
      tenantId, staff.id, 'suspend', 'SUSPENDED',
      /* cascadeFrom */['ACTIVE'], 'suspend', actor,
    );
    return this.findOne(tenantId, userId);
  }

  async reactivate(tenantId: string, userId: string, actor?: CurrentUserPayload) {
    const staff = await this.findOne(tenantId, userId);
    await this.transitionStaffAndAssignments(
      tenantId, staff.id, 'reactivate', 'ACTIVE',
      ['SUSPENDED'], 'reactivate', actor,
    );
    return this.findOne(tenantId, userId);
  }

  async archive(tenantId: string, userId: string, actor?: CurrentUserPayload) {
    const staff = await this.findOne(tenantId, userId);
    // Engine transition Staff → ARCHIVED
    await this.workflow.transition(
      staff as Parameters<typeof this.workflow.transition>[0],
      { action: 'archive', actor: actor ?? SYSTEM_ACTOR },
      {
        aggregateType: 'Staff',
        persist: async (entity, state, p) => {
          return p.staff.update({
            where: { id: entity.id },
            data:  { status: state, version: { increment: 1 } },
          }) as Promise<typeof entity>;
        },
      },
    );
    // Cascade : clore toutes les affectations ouvertes — transitionner chacune
    // individuellement via l'engine (invariant DESIGN §5.2 préservé).
    const openAssignments = await this.prisma.staffAssignment.findMany({
      where: { staffId: staff.id, staff: { tenantId }, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    });
    for (const assignment of openAssignments) {
      await this.workflow.transition(
        { ...assignment, tenantId } as unknown as Parameters<typeof this.workflow.transition>[0],
        { action: 'close', actor: actor ?? SYSTEM_ACTOR },
        {
          aggregateType: 'StaffAssignment',
          persist: async (entity, state, p) => {
            return p.staffAssignment.update({
              where: { id: entity.id },
              data:  {
                status:      state,
                endDate:     new Date(),
                isAvailable: false,
                version:     { increment: 1 },
              },
            }) as unknown as Promise<typeof entity>;
          },
        },
      );
    }
    return { archived: true };
  }

  /**
   * Helper : transitionne le Staff via l'engine, puis propage la même transition
   * à toutes les StaffAssignment actives du staff (cascade blueprint-driven).
   * @param fromAssignmentStates État(s) d'origine des affectations à basculer.
   * @param assignmentAction Action blueprint à exécuter sur chaque affectation.
   */
  private async transitionStaffAndAssignments(
    tenantId: string,
    staffId: string,
    staffAction: string,
    _expectedStaffState: string,
    fromAssignmentStates: string[],
    assignmentAction: string,
    actor?: CurrentUserPayload,
  ) {
    const staff = await this.prisma.staff.findFirst({ where: { id: staffId, tenantId } });
    if (!staff) throw new NotFoundException(`Staff ${staffId} introuvable`);

    await this.workflow.transition(
      staff as Parameters<typeof this.workflow.transition>[0],
      { action: staffAction, actor: actor ?? SYSTEM_ACTOR },
      {
        aggregateType: 'Staff',
        persist: async (entity, state, p) => {
          return p.staff.update({
            where: { id: entity.id },
            data:  { status: state, version: { increment: 1 } },
          }) as Promise<typeof entity>;
        },
      },
    );

    const assignments = await this.prisma.staffAssignment.findMany({
      where: { staffId: staff.id, staff: { tenantId }, status: { in: fromAssignmentStates } },
    });
    for (const assignment of assignments) {
      await this.workflow.transition(
        { ...assignment, tenantId } as unknown as Parameters<typeof this.workflow.transition>[0],
        { action: assignmentAction, actor: actor ?? SYSTEM_ACTOR },
        {
          aggregateType: 'StaffAssignment',
          persist: async (entity, state, p) => {
            return p.staffAssignment.update({
              where: { id: entity.id },
              data:  { status: state, version: { increment: 1 } },
            }) as unknown as Promise<typeof entity>;
          },
        },
      );
    }
  }

  private generateTemporaryPassword(): string {
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!';
  }
}
