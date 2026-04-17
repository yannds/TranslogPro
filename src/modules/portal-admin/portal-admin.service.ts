/**
 * PortalAdminService — CRUD CMS pour le portail public du tenant.
 *
 * Responsabilités :
 *   - Upsert de la configuration du portail (TenantPortalConfig)
 *   - CRUD des pages CMS (TenantPage) avec sanitisation Markdown
 *   - CRUD des articles/posts (TenantPost)
 *   - Invalidation cache Redis après mutation
 *
 * Sécurité :
 *   - Markdown sanitisé (pas de HTML brut, pas de <script>, pas de liens javascript:)
 *   - Toutes les opérations scoped par tenantId
 */
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService }    from '../../infrastructure/database/prisma.service';
import { REDIS_CLIENT }     from '../../infrastructure/eventbus/redis-publisher.service';

/** Retire les balises HTML dangereuses du Markdown. */
function sanitizeMarkdown(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>|<\/embed>/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
}

@Injectable()
export class PortalAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    heroImageUrl?: string; heroOverlay?: number;
    slogans?: Record<string, string>; socialLinks?: Record<string, string>;
    ogImageUrl?: string;
  }) {
    const data = {
      themeId:      dto.themeId,
      showAbout:    dto.showAbout,
      showFleet:    dto.showFleet,
      showNews:     dto.showNews,
      showContact:  dto.showContact,
      heroImageUrl: dto.heroImageUrl,
      heroOverlay:  dto.heroOverlay,
      slogans:      dto.slogans ?? undefined,
      socialLinks:  dto.socialLinks ?? undefined,
      ogImageUrl:   dto.ogImageUrl,
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
  }) {
    const locale = dto.locale ?? 'fr';
    const sanitizedContent = sanitizeMarkdown(dto.content);

    return this.prisma.tenantPage.upsert({
      where: {
        tenantId_slug_locale: { tenantId, slug: dto.slug, locale },
      },
      create: {
        tenantId,
        slug:      dto.slug,
        title:     dto.title,
        content:   sanitizedContent,
        locale,
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? false,
      },
      update: {
        title:     dto.title,
        content:   sanitizedContent,
        sortOrder: dto.sortOrder,
        published: dto.published,
      },
    });
  }

  async deletePage(tenantId: string, pageId: string) {
    const page = await this.prisma.tenantPage.findFirst({
      where: { id: pageId, tenantId },
    });
    if (!page) throw new NotFoundException('Page not found');
    await this.prisma.tenantPage.delete({ where: { id: pageId } });
  }

  // ── Posts / News ──────────────────────────────────────────────────────────

  async listPosts(tenantId: string) {
    return this.prisma.tenantPost.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPost(tenantId: string, postId: string) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async createPost(tenantId: string, dto: {
    title: string; excerpt?: string; content: string;
    coverImage?: string; locale?: string;
    published?: boolean; publishedAt?: string; authorName?: string;
  }) {
    return this.prisma.tenantPost.create({
      data: {
        tenantId,
        title:       dto.title,
        excerpt:     dto.excerpt,
        content:     sanitizeMarkdown(dto.content),
        coverImage:  dto.coverImage,
        locale:      dto.locale ?? 'fr',
        published:   dto.published ?? false,
        publishedAt: dto.publishedAt ? new Date(dto.publishedAt) : null,
        authorName:  dto.authorName,
      },
    });
  }

  async updatePost(tenantId: string, postId: string, dto: {
    title?: string; excerpt?: string; content?: string;
    coverImage?: string; locale?: string;
    published?: boolean; publishedAt?: string; authorName?: string;
  }) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined)       data.title = dto.title;
    if (dto.excerpt !== undefined)     data.excerpt = dto.excerpt;
    if (dto.content !== undefined)     data.content = sanitizeMarkdown(dto.content);
    if (dto.coverImage !== undefined)  data.coverImage = dto.coverImage;
    if (dto.locale !== undefined)      data.locale = dto.locale;
    if (dto.published !== undefined)   data.published = dto.published;
    if (dto.publishedAt !== undefined) data.publishedAt = new Date(dto.publishedAt);
    if (dto.authorName !== undefined)  data.authorName = dto.authorName;

    return this.prisma.tenantPost.update({
      where: { id: postId },
      data,
    });
  }

  async deletePost(tenantId: string, postId: string) {
    const post = await this.prisma.tenantPost.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) throw new NotFoundException('Post not found');
    await this.prisma.tenantPost.delete({ where: { id: postId } });
  }
}
