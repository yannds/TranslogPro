/**
 * WhiteLabelService — Gestion de la marque blanche par tenant.
 *
 * Responsabilités :
 *  1. Persister la configuration visuelle dans `tenant_brands` (Prisma).
 *  2. Exposer `getBrand(tenantId)` avec cache Redis TTL 5 min.
 *  3. Générer la chaîne CSS variables à injecter dans le layout.
 *  4. Invalider le cache en cas de mise à jour.
 *
 * Règle de sécurité :
 *  - `customCss` : les propriétés qui référencent des URLs externes
 *    (ex: background-image, @import) sont retirées avant injection.
 *    Seules les déclarations de propriétés CSS inline sûres sont conservées.
 */
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Redis }         from 'ioredis';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { UpsertBrandDto } from './dto/upsert-brand.dto';
import { REDIS_CLIENT }  from '../../infrastructure/eventbus/redis-publisher.service';

export interface BrandConfig {
  brandName:        string;
  logoUrl:          string | null;
  faviconUrl:       string | null;
  primaryColor:     string;
  secondaryColor:   string;
  accentColor:      string;
  textColor:        string;
  bgColor:          string;
  fontFamily:       string;
  customCss:        string | null;
  metaTitle:        string | null;
  metaDescription:  string | null;
  supportEmail:     string | null;
  supportPhone:     string | null;
  /** Nom affiché dans le "From" des emails transactionnels. */
  emailFromName:    string | null;
  /** Adresse "From" (doit être autorisée côté provider — cf. DKIM/SPF). */
  emailFromAddress: string | null;
  /** Adresse "Reply-To" optionnelle. Fallback sur emailFromAddress si null. */
  emailReplyTo:     string | null;
}

/** Valeurs par défaut appliquées si aucun TenantBrand n'existe encore. */
const DEFAULT_BRAND: BrandConfig = {
  brandName:        'TranslogPro',
  logoUrl:          null,
  faviconUrl:       null,
  primaryColor:     '#2563eb',
  secondaryColor:   '#1a3a5c',
  accentColor:      '#f59e0b',
  textColor:        '#111827',
  bgColor:          '#ffffff',
  fontFamily:       'Inter, sans-serif',
  customCss:        null,
  metaTitle:        null,
  metaDescription:  null,
  supportEmail:     null,
  supportPhone:     null,
  emailFromName:    null,
  emailFromAddress: null,
  emailReplyTo:     null,
};

const CACHE_TTL_SEC = 300; // 5 minutes — aligne sur TenantConfig

/** Retire les déclarations CSS potentiellement dangereuses (url(), @import …). */
function sanitizeCss(raw: string): string {
  return raw
    .replace(/@import\s+[^;]+;?/gi,              '')  // @import
    .replace(/url\s*\([^)]*\)/gi,                '')  // url(...)
    .replace(/expression\s*\([^)]*\)/gi,         '')  // IE expression()
    .replace(/javascript\s*:/gi,                 '')  // javascript:
    .replace(/-moz-binding\s*:[^;]+;?/gi,        ''); // XBL binding (ancien Firefox)
}

@Injectable()
export class WhiteLabelService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ─── Cache ──────────────────────────────────────────────────────────────────

  private cacheKey(tenantId: string): string {
    return `wl:brand:${tenantId}`;
  }

  async getBrand(tenantId: string): Promise<BrandConfig> {
    const cached = await this.redis.get(this.cacheKey(tenantId));
    if (cached) return JSON.parse(cached) as BrandConfig;

    const record = await this.prisma.tenantBrand.findUnique({
      where: { tenantId },
    });

    const brand: BrandConfig = record
      ? {
          brandName:        record.brandName,
          logoUrl:          record.logoUrl,
          faviconUrl:       record.faviconUrl,
          primaryColor:     record.primaryColor,
          secondaryColor:   record.secondaryColor,
          accentColor:      record.accentColor,
          textColor:        record.textColor,
          bgColor:          record.bgColor,
          fontFamily:       record.fontFamily,
          customCss:        record.customCss ? sanitizeCss(record.customCss) : null,
          metaTitle:        record.metaTitle,
          metaDescription:  record.metaDescription,
          supportEmail:     record.supportEmail,
          supportPhone:     record.supportPhone,
          emailFromName:    record.emailFromName,
          emailFromAddress: record.emailFromAddress,
          emailReplyTo:     record.emailReplyTo,
        }
      : { ...DEFAULT_BRAND };

    await this.redis.setex(this.cacheKey(tenantId), CACHE_TTL_SEC, JSON.stringify(brand));
    return brand;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async upsert(tenantId: string, dto: UpsertBrandDto): Promise<BrandConfig> {
    const data = {
      brandName:        dto.brandName,
      logoUrl:          dto.logoUrl          ?? null,
      faviconUrl:       dto.faviconUrl        ?? null,
      primaryColor:     dto.primaryColor     ?? '#2563eb',
      secondaryColor:   dto.secondaryColor   ?? '#1a3a5c',
      accentColor:      dto.accentColor      ?? '#f59e0b',
      textColor:        dto.textColor        ?? '#111827',
      bgColor:          dto.bgColor          ?? '#ffffff',
      fontFamily:       dto.fontFamily       ?? 'Inter, sans-serif',
      // Sanitize aussi à l'écriture (defense in depth) — évite de garder des
      // @import / url() / javascript: en DB même si la lecture re-sanitize.
      customCss:        dto.customCss ? sanitizeCss(dto.customCss) : null,
      metaTitle:        dto.metaTitle         ?? null,
      metaDescription:  dto.metaDescription  ?? null,
      supportEmail:     dto.supportEmail      ?? null,
      supportPhone:     dto.supportPhone      ?? null,
      emailFromName:    dto.emailFromName     ?? null,
      emailFromAddress: dto.emailFromAddress  ?? null,
      emailReplyTo:     dto.emailReplyTo      ?? null,
    };

    await this.prisma.tenantBrand.upsert({
      where:  { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    // Invalider le cache immédiatement
    await this.redis.del(this.cacheKey(tenantId));
    return this.getBrand(tenantId);
  }

  async remove(tenantId: string): Promise<void> {
    const record = await this.prisma.tenantBrand.findUnique({ where: { tenantId } });
    if (!record) throw new NotFoundException(`Aucune configuration de marque pour ce tenant`);
    await this.prisma.tenantBrand.delete({ where: { tenantId } });
    await this.redis.del(this.cacheKey(tenantId));
  }

  // ─── CSS Injection ──────────────────────────────────────────────────────────

  /**
   * Génère un bloc `<style>` à injecter dans le `<head>` du layout Next.js.
   * Les couleurs/polices sont exposées en CSS custom properties (variables).
   * Le `customCss` du tenant est ajouté après, dans son propre bloc isolé.
   */
  buildStyleTag(brand: BrandConfig): string {
    const vars = [
      `--color-primary:   ${brand.primaryColor};`,
      `--color-secondary: ${brand.secondaryColor};`,
      `--color-accent:    ${brand.accentColor};`,
      `--color-text:      ${brand.textColor};`,
      `--color-bg:        ${brand.bgColor};`,
      `--font-brand:      ${brand.fontFamily};`,
    ].join('\n      ');

    const customBlock = brand.customCss
      ? `\n/* tenant custom */\n${brand.customCss}`
      : '';

    return `<style data-tenant-brand>
  :root {
      ${vars}
  }${customBlock}
</style>`;
  }

  /**
   * Version JSON à consommer par un provider React/Next.js côté client
   * (injecté via `getServerSideProps` ou un endpoint `/api/brand`).
   */
  buildThemeTokens(brand: BrandConfig): Record<string, string> {
    return {
      primaryColor:   brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      accentColor:    brand.accentColor,
      textColor:      brand.textColor,
      bgColor:        brand.bgColor,
      fontFamily:     brand.fontFamily,
    };
  }

  // ─── Identité email transactionnel ──────────────────────────────────────────

  /**
   * Résout l'adresse d'envoi email pour un tenant donné.
   *
   * Priorité :
   *   1. TenantBrand.emailFromAddress (+ emailFromName optionnel)
   *   2. Fallback plateforme fourni par le caller (default des services email)
   *
   * Retourne `{ from, replyTo }` prêts à injecter dans SendEmailDto.
   * `tenantId` null → pas de lookup, fallback direct (flux plateforme comme
   * activation SaaS, waitlist public signup).
   */
  async resolveFromForTenant(
    tenantId: string | null,
    platformFallback: { fromName: string; fromAddress: string; replyTo?: string },
  ): Promise<{ from: { name?: string; email: string }; replyTo?: { name?: string; email: string } }> {
    if (!tenantId) {
      return {
        from:    { name: platformFallback.fromName, email: platformFallback.fromAddress },
        replyTo: platformFallback.replyTo ? { email: platformFallback.replyTo } : undefined,
      };
    }
    const brand = await this.getBrand(tenantId);
    const fromEmail = brand.emailFromAddress ?? platformFallback.fromAddress;
    const fromName  = brand.emailFromName    ?? platformFallback.fromName;
    const replyTo   = brand.emailReplyTo     ?? platformFallback.replyTo ?? null;
    return {
      from:    { name: fromName, email: fromEmail },
      replyTo: replyTo ? { email: replyTo } : undefined,
    };
  }
}
