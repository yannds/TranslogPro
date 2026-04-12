import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { Inject } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';

export interface CreateTenantDto {
  name:       string;
  slug:       string;
  adminEmail: string;
  adminName:  string;
}

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma:  PrismaService,
    @Inject(SECRET_SERVICE) private readonly secretService: ISecretService,
  ) {}

  async create(dto: CreateTenantDto) {
    const exists = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new ConflictException(`Tenant slug "${dto.slug}" already taken`);

    const tenant = await this.prisma.tenant.create({
      data: { name: dto.name, slug: dto.slug, status: 'ACTIVE' },
    });

    // Provision HMAC key for QR codes in Vault
    const hmacKey = randomBytes(32).toString('hex');
    await this.secretService.putSecret(`tenants/${tenant.id}/hmac`, { KEY: hmacKey });

    // Create admin user (seeded — Better Auth creates the session-side record separately)
    await this.prisma.user.create({
      data: {
        email:    dto.adminEmail,
        name:     dto.adminName,
        tenantId: tenant.id,
        role:     'TENANT_ADMIN',
      },
    });

    return tenant;
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  async list() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async suspend(id: string) {
    return this.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } });
  }
}
