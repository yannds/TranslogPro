import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IIdentityManager, IDENTITY_SERVICE } from '../../infrastructure/identity/interfaces/identity.interface';
import { Inject } from '@nestjs/common';

export interface CreateStaffDto {
  email:    string;
  name:     string;
  role:     string;
  agencyId?: string | null;
  licenseData?: Record<string, unknown>;
}

export interface UpdateStaffDto {
  name?:        string;
  role?:        string;
  agencyId?:    string | null;
  licenseData?: Record<string, unknown>;
  isAvailable?: boolean;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma:    PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IIdentityManager,
  ) {}

  async create(tenantId: string, dto: CreateStaffDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Email ${dto.email} déjà enregistré`);

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

    // Phase 2 : double-écriture Staff + StaffAssignment (sera simplifiée Phase 5)
    const licenseData = (dto.licenseData ?? {}) as any;
    const staff = await this.prisma.staff.create({
      data: {
        userId:      user.id,
        tenantId,
        agencyId,
        role:        dto.role,
        licenseData,
        status:      'ACTIVE',
      },
    });
    await this.prisma.staffAssignment.create({
      data: {
        staffId:     staff.id,
        role:        dto.role,
        agencyId,
        status:      'ACTIVE',
        licenseData,
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
        user:        { select: { id: true, email: true, name: true, roleId: true } },
        assignments: {
          where:  { status: 'ACTIVE' },
          select: { id: true, role: true, agencyId: true, status: true, isAvailable: true, startDate: true },
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

    const licenseData = (dto.licenseData ?? {}) as any;
    const staff = await this.prisma.staff.create({
      data: {
        userId,
        tenantId,
        agencyId,
        role:        dto.role,
        licenseData,
        status:      'ACTIVE',
      },
    });
    await this.prisma.staffAssignment.create({
      data: {
        staffId:     staff.id,
        role:        dto.role,
        agencyId,
        status:      'ACTIVE',
        licenseData,
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
        ...(dto.role        !== undefined ? { role:        dto.role }                : {}),
        ...(dto.agencyId    !== undefined ? { agencyId:    dto.agencyId ?? null }    : {}),
        ...(dto.licenseData !== undefined ? { licenseData: dto.licenseData as any }  : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable }         : {}),
      },
      include: { user: true },
    });

    // Phase 2 : double-écriture sur l'affectation active courante.
    // Le rôle Staff legacy reste mono — on synchronise l'unique affectation
    // ACTIVE (cas standard avant Phase 4 qui exposera la gestion N rôles).
    const activeAssignment = await this.prisma.staffAssignment.findFirst({
      where:  { staffId: staff.id, status: 'ACTIVE' },
      orderBy: { startDate: 'desc' },
    });
    if (activeAssignment) {
      await this.prisma.staffAssignment.update({
        where: { id: activeAssignment.id },
        data:  {
          ...(dto.role        !== undefined ? { role:        dto.role }                : {}),
          ...(dto.agencyId    !== undefined ? { agencyId:    dto.agencyId ?? null }    : {}),
          ...(dto.licenseData !== undefined ? { licenseData: dto.licenseData as any }  : {}),
          ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable }         : {}),
        },
      });
    }

    return updated;
  }

  async suspend(tenantId: string, userId: string) {
    const staff = await this.findOne(tenantId, userId);
    const result = await this.prisma.staff.update({ where: { userId }, data: { status: 'SUSPENDED' } });
    await this.prisma.staffAssignment.updateMany({
      where: { staffId: staff.id, status: 'ACTIVE' },
      data:  { status: 'SUSPENDED' },
    });
    return result;
  }

  async reactivate(tenantId: string, userId: string) {
    const staff = await this.findOne(tenantId, userId);
    const result = await this.prisma.staff.update({ where: { userId }, data: { status: 'ACTIVE' } });
    await this.prisma.staffAssignment.updateMany({
      where: { staffId: staff.id, status: 'SUSPENDED' },
      data:  { status: 'ACTIVE' },
    });
    return result;
  }

  async archive(tenantId: string, userId: string) {
    const staff = await this.findOne(tenantId, userId);
    await this.prisma.staff.update({ where: { userId }, data: { status: 'ARCHIVED', isAvailable: false } });
    // Cascade : clore toutes les affectations ouvertes (invariant §5.2)
    await this.prisma.staffAssignment.updateMany({
      where: { staffId: staff.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      data:  { status: 'CLOSED', endDate: new Date(), isAvailable: false },
    });
    return { archived: true };
  }

  private generateTemporaryPassword(): string {
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!';
  }
}
