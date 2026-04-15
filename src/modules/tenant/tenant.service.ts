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

/**
 * DTO pour la mise à jour des informations société du tenant.
 * Tous les champs sont optionnels (update partiel).
 * Les champs rccm et phoneNumber restent nullable en base.
 */
export interface UpdateCompanyInfoDto {
  name?:        string;
  language?:    string;  // 'fr' | 'en' (étendu plus tard)
  timezone?:    string;  // IANA TZ
  currency?:    string;  // ISO 4217
  rccm?:        string | null;
  phoneNumber?: string | null;
}

const SUPPORTED_LANGUAGES = ['fr', 'en'];

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
      data: { name: dto.name, slug: dto.slug, provisionStatus: 'ACTIVE' },
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
        userType: 'STAFF',
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
    return this.prisma.tenant.update({ where: { id }, data: { provisionStatus: 'SUSPENDED' } });
  }

  /**
   * Informations société du tenant — lecture publique (pas d'authentification
   * requise) car utilisée par le bootstrap i18n frontend et les portails SSR.
   */
  async getCompanyInfo(tenantId: string) {
    const t = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id: true, name: true, slug: true,
        language: true, timezone: true, currency: true,
        rccm: true, phoneNumber: true,
      },
    });
    if (!t) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return t;
  }

  async updateCompanyInfo(tenantId: string, dto: UpdateCompanyInfoDto) {
    if (dto.language !== undefined && !SUPPORTED_LANGUAGES.includes(dto.language)) {
      throw new ConflictException(
        `Language "${dto.language}" non supportée. Valeurs : ${SUPPORTED_LANGUAGES.join(', ')}`,
      );
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.name        !== undefined ? { name:        dto.name }        : {}),
        ...(dto.language    !== undefined ? { language:    dto.language }    : {}),
        ...(dto.timezone    !== undefined ? { timezone:    dto.timezone }    : {}),
        ...(dto.currency    !== undefined ? { currency:    dto.currency }    : {}),
        ...(dto.rccm        !== undefined ? { rccm:        dto.rccm }        : {}),
        ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
      },
      select: {
        id: true, name: true, slug: true,
        language: true, timezone: true, currency: true,
        rccm: true, phoneNumber: true,
      },
    });
    return updated;
  }

  /**
   * Configuration agrégée — appelée par TenantConfigProvider côté frontend
   * au bootstrap pour pré-remplir i18n, currency, timezone, brand.
   * Lecture publique intentionnelle : aucune donnée sensible.
   */
  async getAggregatedConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        id: true, name: true, slug: true,
        language: true, timezone: true, currency: true,
        rccm: true, phoneNumber: true,
        brand: true,
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    return {
      company: {
        id: tenant.id, name: tenant.name, slug: tenant.slug,
        language: tenant.language, timezone: tenant.timezone, currency: tenant.currency,
        rccm: tenant.rccm, phoneNumber: tenant.phoneNumber,
      },
      brand: tenant.brand,
    };
  }
}
