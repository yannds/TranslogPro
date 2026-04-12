import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IIdentityManager, IDENTITY_SERVICE } from '../../infrastructure/identity/interfaces/identity.interface';
import { Inject } from '@nestjs/common';

export interface CreateStaffDto {
  email:    string;
  name:     string;
  role:     string;
  agencyId: string;
  licenseData?: Record<string, unknown>;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma:    PrismaService,
    @Inject(IDENTITY_SERVICE) private readonly identity: IIdentityManager,
  ) {}

  async create(tenantId: string, dto: CreateStaffDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Email ${dto.email} already registered`);

    const user = await this.identity.createUser({
      email:    dto.email,
      password: this.generateTemporaryPassword(),
      name:     dto.name,
      tenantId,
      agencyId: dto.agencyId,
      userType: 'STAFF',
    });

    await this.prisma.staff.create({
      data: {
        userId:      user.id,
        tenantId,
        agencyId:    dto.agencyId,
        role:        dto.role,
        licenseData: (dto.licenseData ?? {}) as any,
        status:      'ACTIVE',
      },
    });

    return user;
  }

  async findAll(tenantId: string, agencyId?: string) {
    return this.prisma.staff.findMany({
      where:   { tenantId, ...(agencyId ? { agencyId } : {}) },
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

  async suspend(tenantId: string, userId: string) {
    await this.findOne(tenantId, userId);
    return this.prisma.staff.update({ where: { userId }, data: { status: 'SUSPENDED' } });
  }

  private generateTemporaryPassword(): string {
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10).toUpperCase() + '!';
  }
}
