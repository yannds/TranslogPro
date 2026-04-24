/**
 * PortalAdminService — CRUD CMS pour le portail public du tenant.
 *
 * Responsabilités :
 *   - Upsert de la configuration du portail (TenantPortalConfig)
 *   - CRUD des pages CMS (TenantPage) avec sanitisation HTML
 *   - CRUD des articles/posts (TenantPost) avec médias
 *   - Invalidation cache Redis après mutation
 *   - Upload URLs pour les médias CMS (photos/vidéos)
 *
 * Sécurité :
 *   - HTML sanitisé (pas de <script>, pas de liens javascript:, pas d'event handlers)
 *   - Toutes les opérations scoped par tenantId
 */
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService }    from '../../infrastructure/database/prisma.service';
import { REDIS_CLIENT }     from '../../infrastructure/eventbus/redis-publisher.service';
import { IStorageService, STORAGE_SERVICE, DocumentType } from '../../infrastructure/storage/interfaces/storage.interface';

/** Sanitise HTML content — strip dangerous tags and attributes. */
function sanitizeHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>|<\/embed>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
}

/** Generate a URL-safe slug from a title. */
function slugify(title: string): string {
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

@Injectable()
export class PortalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  // ── Portal Config ─────────────────────────────────────────────────────────

  async getPortalConfig(tenantId: string) {
    return this.prisma.tenantPortalConfig.findUnique({
      where: { tenantId },
    });
  }

  async upsertPortalConfig(tenantId: string, dto: {
    themeId?: string;
    showAbout?: boolean; showFleet?: boolean; showNews?: boolean; showContact?: boolean;
    newsCmsEnabled?: boolean;
    heroImageUrl?: string; heroOverlay?: number;
    slogans?: Record<string, string>; socialLinks?: Record<string, string>;
    ogImageUrl?: string;
  }) {
    const data = {
      themeId:        dto.themeId,
      showAbout:      dto.showAbout,
      showFleet:      dto.showFleet,
      showNews:       dto.showNews,
      showContact:    dto.showContact,
      newsCmsEnabled: dto.newsCmsEnabled,
      heroImageUrl:   dto.heroImageUrl,
      heroOverlay:    dto.heroOverlay,
      slogans:        dto.slogans ?? undefined,
      socialLinks:    dto.socialLinks ?? undefined,
      ogImageUrl:     dto.ogImageUrl,
    };

    // Remove undefined to avoid overwriting existing values
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    const result = await this.prisma.tenantPortalConfig.upsert({
      where:  { tenantId },
      create: { tenantId, ...cleanData },
      update: cleanData,
    });

    // Invalidate portal config cache — find tenant slug and clear
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    if (tenant) await this.redis.del(`portal:slug:${tenant.slug}`);
    return result;
  }

  // ── Pages CMS ─────────────────────────────────────────────────────────────

  /** Slugs système — contenu JSON structuré avec limites de caractères. */
  private static readonly SYSTEM_SLUGS = ['hero', 'about', 'contact'] as const;

  private static readonly CMS_LIMITS = {
    hero:    { title: 60, subtitle: 200, trustedBy: 100 },
    about:   { description: 500, featureTitle: 30, featureDesc: 80 },
    contact: { hours: 100 },
  } as const;

  /**
   * Valide le contenu JSON structuré pour les pages système.
   * Lève BadRequestException si un champ dépasse la limite.
   */
  private validateSystemPageContent(slug: string, content: string): void {
    if (!(PortalAdminService.SYSTEM_SLUGS as readonly string[]).includes(slug)) return;

    let data: Record<string, unknown>;
    try { data = JSON.parse(content); }
    catch { throw new BadRequestException(`Le contenu de la page "${slug}" doit être du JSON valide`); }

    const check = (field: string, value: unknown, max: number) => {
      if (typeof value === 'string' && value.length > max) {
        throw new BadRequestException(`${field} : ${value.length} caractères (max ${max})`);
      }
    };

    if (slug === 'hero') {
      const L = PortalAdminService.CMS_LIMITS.hero;
      check('title',     data.title,     L.title);
      check('subtitle',  data.subtitle,  L.subtitle);
      check('trustedBy', data.trustedBy, L.trustedBy);
    } else if (slug === 'about') {
      const L = PortalAdminService.CMS_LIMITS.about;
      check('description', data.description, L.description);
      const features = Array.isArray(data.features) ? data.features : [];
      for (const f of features) {
        check('feature.title',       f?.title,       L.featureTitle);
        check('feature.description', f?.description, L.featureDesc);
      }
    } else if (slug === 'contact') {
      const L = PortalAdminService.CMS_LIMITS.contact;
      check('hours', data.hours, L.hours);
    }
  }

  async listPages(tenantId: string) {
    return this.prisma.tenantPage.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getPage(tenantId: string, pageId: string) {
    const page = await this.prisma.tenantPage.findFirst({
      where: { id: pageId, tenantId },
    });
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async upsertPage(tenantId: string, dto: {
    slug: string; title: string; content: string;
    locale?: string; sortOrder?: number; published?: boolean;
    showInFooter?: boolean;
  }) {
    const locale = dto.locale ?? 'fr';

    // Validation structurée pour les pages système (hero, about, contact)
    this.validateSystemPageContent(dto.slug, dto.content);

    // Sanitize HTML uniquement pour les pages custom (les pages système stockent du JSON)
    const isSystem = (PortalAdminService.SYSTEM_SLUGS as readonly string[]).includes(dto.slug);
    const sanitizedContent = isSystem ? dto.content : sanitizeHtml(dto.content);

    return this.prisma.tenantPage.upsert({
      where: {
        tenantId_slug_locale: { tenantId, slug: dto.slug, locale },
      },
      create: {
        tenantId,
        slug:         dto.slug,
        title:        dto.title,
        content:      sanitizedContent,
        locale,
        sortOrder:    dto.sortOrder ?? 0,
        published:    dto.published ?? false,
        showInFooter: dto.showInFooter ?? false,
      },
      update: {
        title:        dto.title,
        content:      sanitizedContent,
        sortOrder:    dto.sortOrder,
        published:    dto.published,
        showInFooter: dto.showInFooter,
      },
    });
  }

  async deletePage(tenantId: string, pageId: string) {
    const page = await this.prisma.tenantPage.findFirst({
      where: { id: pageId, tenantId },
    });
    if (!page) throw new NotFoundException('Page not found');

    // Interdire la suppression des pages système
    if ((PortalAdminService.SYSTEM_SLUGS as readonly string[]).includes(page.slug)) {
      throw new ForbiddenException('Les pages système (hero, about, contact) ne peuvent pas être supprimées');
    }

    await this.prisma.tenantPage.delete({ where: { id: pageId } });
  }

  // ── Posts / News ──────────────────────────────────────────────────────────

  async listPosts(tenantId: string) {
    return this.prisma.tenantPost.findMany({
      where: { tenantId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPost(tenantId: string, postId: string) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!post) throw new NotFoundException('Post not found');

    // Resolve signed URLs for media
    const mediaWithUrls = await Promise.all(
      post.media.map(async (m) => {
        try {
          const signed = await this.storage.getDownloadUrl(tenantId, m.url, DocumentType.CMS_MEDIA);
          return { ...m, signedUrl: signed.url };
        } catch {
          return { ...m, signedUrl: null };
        }
      }),
    );

    // Resolve cover image URL
    let coverImageUrl: string | null = null;
    if (post.coverImage) {
      try {
        const signed = await this.storage.getDownloadUrl(tenantId, post.coverImage, DocumentType.CMS_MEDIA);
        coverImageUrl = signed.url;
      } catch { /* ignore */ }
    }

    return { ...post, media: mediaWithUrls, coverImageUrl };
  }

  async createPost(tenantId: string, dto: {
    title: string; excerpt?: string; content: string;
    coverImage?: string; locale?: string;
    published?: boolean; publishedAt?: string; authorName?: string;
    tags?: string[];
    media?: Array<{ url: string; type: string; caption?: string; sortOrder?: number }>;
  }) {
    const slug = slugify(dto.title) + '-' + Date.now().toString(36);

    const post = await this.prisma.tenantPost.create({
      data: {
        tenantId,
        title:       dto.title,
        slug,
        excerpt:     dto.excerpt,
        content:     sanitizeHtml(dto.content),
        coverImage:  dto.coverImage,
        locale:      dto.locale ?? 'fr',
        published:   dto.published ?? false,
        publishedAt: dto.published ? (dto.publishedAt ? new Date(dto.publishedAt) : new Date()) : null,
        authorName:  dto.authorName,
        tags:        dto.tags ?? [],
        media: dto.media?.length ? {
          createMany: {
            data: dto.media.map((m, i) => ({
              url:       m.url,
              type:      m.type,
              caption:   m.caption,
              sortOrder: m.sortOrder ?? i,
            })),
          },
        } : undefined,
      },
      include: { media: true },
    });

    return post;
  }

  async updatePost(tenantId: string, postId: string, dto: {
    title?: string; excerpt?: string; content?: string;
    coverImage?: string; locale?: string;
    published?: boolean; publishedAt?: string; authorName?: string;
    tags?: string[];
    media?: Array<{ url: string; type: string; caption?: string; sortOrder?: number }>;
  }) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined)       data.title = dto.title;
    if (dto.excerpt !== undefined)     data.excerpt = dto.excerpt;
    if (dto.content !== undefined)     data.content = sanitizeHtml(dto.content);
    if (dto.coverImage !== undefined)  data.coverImage = dto.coverImage;
    if (dto.locale !== undefined)      data.locale = dto.locale;
    if (dto.tags !== undefined)        data.tags = dto.tags;
    if (dto.authorName !== undefined)  data.authorName = dto.authorName;

    if (dto.published !== undefined) {
      data.published = dto.published;
      if (dto.published && !post.publishedAt) {
        data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : new Date();
      }
    }

    // Replace media if provided
    if (dto.media !== undefined) {
      await this.prisma.postMedia.deleteMany({ where: { postId } });
      if (dto.media.length > 0) {
        await this.prisma.postMedia.createMany({
          data: dto.media.map((m, i) => ({
            postId,
            url:       m.url,
            type:      m.type,
            caption:   m.caption,
            sortOrder: m.sortOrder ?? i,
          })),
        });
      }
    }

    return this.prisma.tenantPost.update({
      where: { id: postId },
      data,
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deletePost(tenantId: string, postId: string) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.tenantPost.delete({ where: { id: postId } });
  }

  // ── Media Upload ──────────────────────────────────────────────────────────

  async getMediaUploadUrl(tenantId: string, filename: string) {
    const key = `cms/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const signed = await this.storage.getUploadUrl(tenantId, key, DocumentType.CMS_MEDIA);
    return { uploadUrl: signed.url, fileKey: signed.key, key: signed.key, expiresAt: signed.expiresAt };
  }
}
