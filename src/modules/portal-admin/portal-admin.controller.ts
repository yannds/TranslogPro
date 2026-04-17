/**
 * PortalAdminController — Gestion CMS du portail public (admin tenant).
 *
 * Toutes les routes nécessitent SETTINGS_MANAGE_TENANT.
 * Path : /api/v1/tenants/:tenantId/portal/*
 *
 * Routes :
 *   GET/PUT   config         — config portail (sections, hero, slogans, CMS toggle)
 *   GET/PUT/DELETE pages     — pages CMS (about, terms, news…)
 *   GET/POST/PUT/DELETE posts — articles/news avec médias
 *   POST media/upload-url    — URL présignée pour upload média CMS
 */
import {
  Controller, Get, Put, Post, Delete, Param, Body, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { PortalAdminService }       from './portal-admin.service';
import { UpsertPortalConfigDto }    from './dto/upsert-portal-config.dto';
import { UpsertPageDto }            from './dto/upsert-page.dto';
import { UpsertPostDto }            from './dto/upsert-post.dto';
import { RequirePermission }        from '../../common/decorators/require-permission.decorator';
import { Permission }               from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId/portal' })
export class PortalAdminController {
  constructor(private readonly service: PortalAdminService) {}

  // ── Portal Config ─────────────────────────────────────────────────────────

  @Get('config')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getConfig(@Param('tenantId') tenantId: string) {
    return this.service.getPortalConfig(tenantId);
  }

  @Put('config')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  upsertConfig(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpsertPortalConfigDto,
  ) {
    return this.service.upsertPortalConfig(tenantId, dto);
  }

  // ── Pages CMS ─────────────────────────────────────────────────────────────

  @Get('pages')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  listPages(@Param('tenantId') tenantId: string) {
    return this.service.listPages(tenantId);
  }

  @Get('pages/:pageId')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getPage(
    @Param('tenantId') tenantId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.service.getPage(tenantId, pageId);
  }

  @Put('pages')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  upsertPage(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpsertPageDto,
  ) {
    return this.service.upsertPage(tenantId, dto);
  }

  @Delete('pages/:pageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  deletePage(
    @Param('tenantId') tenantId: string,
    @Param('pageId') pageId: string,
  ) {
    return this.service.deletePage(tenantId, pageId);
  }

  // ── Posts / News ──────────────────────────────────────────────────────────

  @Get('posts')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  listPosts(@Param('tenantId') tenantId: string) {
    return this.service.listPosts(tenantId);
  }

  @Get('posts/:postId')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getPost(
    @Param('tenantId') tenantId: string,
    @Param('postId') postId: string,
  ) {
    return this.service.getPost(tenantId, postId);
  }

  @Post('posts')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  createPost(
    @Param('tenantId') tenantId: string,
    @Body() dto: UpsertPostDto,
  ) {
    return this.service.createPost(tenantId, dto);
  }

  @Put('posts/:postId')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  updatePost(
    @Param('tenantId') tenantId: string,
    @Param('postId') postId: string,
    @Body() dto: UpsertPostDto,
  ) {
    return this.service.updatePost(tenantId, postId, dto);
  }

  @Delete('posts/:postId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  deletePost(
    @Param('tenantId') tenantId: string,
    @Param('postId') postId: string,
  ) {
    return this.service.deletePost(tenantId, postId);
  }

  // ── Media Upload ──────────────────────────────────────────────────────────

  @Post('media/upload-url')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  getMediaUploadUrl(
    @Param('tenantId') tenantId: string,
    @Body('filename') filename: string,
  ) {
    return this.service.getMediaUploadUrl(tenantId, filename);
  }
}
