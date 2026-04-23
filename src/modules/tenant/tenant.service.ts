import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ISecretService, SECRET_SERVICE } from '../../infrastructure/secret/interfaces/secret.interface';
import { Inject } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { seedCmsPages } from '../../../prisma/seeds/cms-pages.seed';

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
export interface UpdateBusinessConfigDto {
  daysPerYear?:            number;
  defaultTripsPerMonth?:   number;
  breakEvenThresholdPct?:  number;
  agencyCommissionRate?:   number;
  stationFeePerDeparture?: number;
  seatSelectionFee?:       number;
  // ── Annulation / remboursement ─────────────────────────────────────────
  cancellationFullRefundMinutes?:    number;
  cancellationPartialRefundMinutes?: number;
  cancellationPartialRefundPct?:     number;
  refundApprovalThreshold?:          number;
  refundAutoApproveMax?:             number;
  autoApproveTripCancelled?:         boolean;
  cancellationPenaltyTiers?:         unknown; // JSON array
  cancellationPenaltyAppliesTo?:     unknown; // JSON string[]
  // ── No-show / TTL ──────────────────────────────────────────────────────
  noShowGraceMinutes?:       number;
  ticketTtlHours?:           number;
  noShowPenaltyEnabled?:     boolean;
  noShowPenaltyPct?:         number;
  noShowPenaltyFlatAmount?:  number;
  // ── Incident / compensation ────────────────────────────────────────────
  incidentCompensationEnabled?:     boolean;
  incidentCompensationDelayTiers?:  unknown; // JSON array
  incidentCompensationFormDefault?: string;  // MONETARY | VOUCHER | MIXED | SNACK
  incidentVoucherValidityDays?:     number;
  incidentVoucherUsageScope?:       string;
  incidentRefundProrataEnabled?:    boolean;
  // ── Parcel hubs / retrait ──────────────────────────────────────────────
  parcelHubMaxStorageDays?:         number;
  parcelPickupMaxDaysBeforeReturn?: number;
  parcelPickupNoShowAction?:        string;  // return | dispose | hold
  // ── Sécurité endpoints publics (2026-04-20) ────────────────────────────
  captchaEnabled?:              boolean;
  dailyMagicLinkBudget?:        number;
  magicLinkPhoneCooldownHours?: number;
}

export interface UpdateCompanyInfoDto {
  name?:        string;
  country?:     string;  // ISO 3166-1 alpha-2
  city?:        string;
  language?:    string;  // 'fr' | 'en' (étendu plus tard)
  timezone?:    string;  // IANA TZ
  currency?:    string;  // ISO 4217
  dateFormat?:  string;  // DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD
  rccm?:        string | null;
  phoneNumber?: string | null;
  email?:       string | null;
  website?:     string | null;
  address?:     string | null;
  taxId?:       string | null;
}

const SUPPORTED_LANGUAGES = ['fr', 'en', 'ln', 'ktu', 'es', 'pt', 'ar', 'wo'];

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

    // Seed default CMS pages + portail config — éditable via portail admin
    await this.seedDefaultCmsPages(tenant.id, dto.name);

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

  async reactivate(id: string) {
    return this.prisma.tenant.update({ where: { id }, data: { provisionStatus: 'ACTIVE' } });
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
        country: true, city: true,
        language: true, timezone: true, currency: true, dateFormat: true,
        rccm: true, phoneNumber: true, email: true, website: true, address: true, taxId: true,
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

    const data: Record<string, unknown> = {};
    // Champs non-nullable : null → valeur par défaut
    const NON_NULLABLE_DEFAULTS: Record<string, string> = {
      country: 'CG', city: '', dateFormat: 'DD/MM/YYYY',
    };
    for (const key of [
      'name', 'country', 'city', 'language', 'timezone', 'currency', 'dateFormat',
      'rccm', 'phoneNumber', 'email', 'website', 'address', 'taxId',
    ] as const) {
      if (dto[key] !== undefined) {
        data[key] = dto[key] ?? NON_NULLABLE_DEFAULTS[key] ?? dto[key];
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: {
        id: true, name: true, slug: true,
        country: true, city: true,
        language: true, timezone: true, currency: true, dateFormat: true,
        rccm: true, phoneNumber: true, email: true, website: true, address: true, taxId: true,
      },
    });

    // Tenant.currency = source de vérité. Si l'admin la change, on ajoute
    // automatiquement la nouvelle devise à TenantPaymentConfig.allowedCurrencies
    // (append, pas replace — les moyens déjà tokenisés dans l'ancienne devise
    // restent valides).
    if (dto.currency !== undefined) {
      await this.ensureAllowedCurrency(tenantId, updated.currency);
    }

    return updated;
  }

  /**
   * Garantit que `currency` est dans `TenantPaymentConfig.allowedCurrencies`.
   * Idempotent — no-op si déjà présente. Upsert la config si absente.
   */
  private async ensureAllowedCurrency(tenantId: string, currency: string): Promise<void> {
    const config = await this.prisma.tenantPaymentConfig.findUnique({
      where:  { tenantId },
      select: { allowedCurrencies: true },
    });
    if (!config) {
      await this.prisma.tenantPaymentConfig.create({
        data: { tenantId, allowedCurrencies: [currency] },
      });
      return;
    }
    if (config.allowedCurrencies.includes(currency)) return;
    await this.prisma.tenantPaymentConfig.update({
      where: { tenantId },
      data:  { allowedCurrencies: { push: currency } },
    });
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
        country: true, city: true,
        language: true, timezone: true, currency: true, dateFormat: true,
        rccm: true, phoneNumber: true, email: true, website: true, address: true, taxId: true,
        brand: true,
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    return {
      company: {
        id: tenant.id, name: tenant.name, slug: tenant.slug,
        country: tenant.country, city: tenant.city,
        language: tenant.language, timezone: tenant.timezone,
        currency: tenant.currency, dateFormat: tenant.dateFormat,
        rccm: tenant.rccm, phoneNumber: tenant.phoneNumber,
        email: tenant.email, website: tenant.website,
        address: tenant.address, taxId: tenant.taxId,
      },
      brand: tenant.brand,
    };
  }

  // ── Business config ─────────────────────────────────────────────────────────

  async getBusinessConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    // Upsert-on-read: guarantee a row always exists. Retourne tous les champs
    // (schema Prisma complet) — plus simple que de maintenir une select list.
    return this.prisma.tenantBusinessConfig.upsert({
      where:  { tenantId },
      create: { tenantId },
      update: {},
    });
  }

  /**
   * Liste des champs autorisés à l'édition. Source unique de vérité pour
   * éviter les écritures non-intentionnelles sur id/tenantId/updatedAt.
   */
  private static readonly EDITABLE_BUSINESS_CONFIG_KEYS = [
    // Base
    'daysPerYear', 'defaultTripsPerMonth',
    'breakEvenThresholdPct', 'agencyCommissionRate', 'stationFeePerDeparture',
    'seatSelectionFee',
    // Fiscalité
    'tvaEnabled', 'tvaRate',
    // Annulation legacy + N-tiers
    'cancellationFullRefundMinutes', 'cancellationPartialRefundMinutes',
    'cancellationPartialRefundPct',
    'refundApprovalThreshold', 'refundAutoApproveMax', 'autoApproveTripCancelled',
    'cancellationPenaltyTiers', 'cancellationPenaltyAppliesTo',
    // No-show
    'noShowGraceMinutes', 'ticketTtlHours',
    'noShowPenaltyEnabled', 'noShowPenaltyPct', 'noShowPenaltyFlatAmount',
    // Incident / compensation
    'incidentCompensationEnabled', 'incidentCompensationDelayTiers',
    'incidentCompensationFormDefault',
    'incidentVoucherValidityDays', 'incidentVoucherUsageScope',
    'incidentRefundProrataEnabled',
    // Parcel hub
    'parcelHubMaxStorageDays', 'parcelPickupMaxDaysBeforeReturn',
    'parcelPickupNoShowAction',
    // Sécurité endpoints publics
    'captchaEnabled', 'dailyMagicLinkBudget', 'magicLinkPhoneCooldownHours',
  ] as const;

  async updateBusinessConfig(tenantId: string, dto: UpdateBusinessConfigDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantId} not found`);

    const data: Record<string, unknown> = {};
    for (const key of TenantService.EDITABLE_BUSINESS_CONFIG_KEYS) {
      const value = (dto as Record<string, unknown>)[key];
      if (value !== undefined) data[key] = value;
    }

    return this.prisma.tenantBusinessConfig.upsert({
      where:  { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  // ─── CMS pages par défaut ─────────────────────────────────────────────────

  /**
   * Crée TenantPortalConfig + pages (about, fleet, contact) + post de bienvenue
   * pour un nouveau tenant créé via l'API plateforme (SUPER_ADMIN).
   * Idempotent — skipDuplicates.
   */
  private async seedDefaultCmsPages(tenantId: string, companyName: string) {
    await seedCmsPages(this.prisma, tenantId, {
      companyName,
      city:    '',
      country: '',
    });
  }
}
