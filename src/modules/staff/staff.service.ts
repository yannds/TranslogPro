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

    await this.prisma.staff.create({
      data: {
        userId:      user.id,
        tenantId,
        agencyId,
        role:        dto.role,
        licenseData: (dto.licenseData ?? {}) as any,
        status:      'ACTIVE',
      },
    });

    return user;
  }

  async findAll(tenantId: string, agencyId?: string, role?: string) {
    return this.prisma.staff.findMany({
      where:   { tenantId, ...(agencyId ? { agencyId } : {}), ...(role ? { role } : {}) },
      include: { user: { select: { id: true, email: true, name: true, roleId: true } } },
      orderBy: { createdAt: 'asc' },
    });
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

    return this.prisma.staff.update({
      where: { userId },
      data:  {
        ...(dto.role        !== undefined ? { role:        dto.role }                : {}),
        ...(dto.agencyId    !== undefined ? { agencyId:    dto.agencyId ?? null }    : {}),
        ...(dto.licenseData !== undefined ? { licenseData: dto.licenseData as any }  : {}),
        ...(dto.isAvailable !== undefined ? { isAvailable: dto.isAvailable }         : {}),
      },
      include: { user: true },
    });
  }

  async suspend(tenantId: string, userId: string) {
    await this.findOne(tenantId, userId);
    return this.prisma.staff.update({ where: { userId }, data: { status: 'SUSPENDED' } });
  }

  async reactivate(tenantId: string, userId: string) {
    await this.findOne(tenantId, userId);
    return this.prisma.staff.update({ where: { userId }, data: { status: 'ACTIVE' } });
  }

  async archive(tenantId: string, userId: string) {
    await this.findOne(tenantId, userId);
    await this.prisma.staff.update({ where: { userId }, data: { status: 'ARCHIVED', isAvailable: false } });
    return { archived: true };
  }

  private generateTemporaryPassword(): string {
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!';
  }
}
