/**
 * SupportController — deux familles de routes :
 *
 *   ── Côté tenant (crée + consulte ses tickets) ──
 *   POST   /support/tickets                       permission data.support.create.tenant
 *   GET    /support/tickets                       permission data.support.read.tenant
 *   GET    /support/tickets/:id                   permission data.support.read.tenant
 *   POST   /support/tickets/:id/messages          permission data.support.create.tenant
 *
 *   ── Côté plateforme (queue globale) ──
 *   GET    /platform/support/tickets              control.platform.support.read.global
 *   GET    /platform/support/tickets/:id          control.platform.support.read.global
 *   PATCH  /platform/support/tickets/:id          control.platform.support.write.global
 *   POST   /platform/support/tickets/:id/messages control.platform.support.write.global
 */
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SupportService } from './support.service';
import {
  AddSupportMessageDto,
  CreateSupportTicketDto,
  SupportPriority,
  SupportStatus,
  UpdateSupportTicketDto,
} from './dto/support.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/constants/permissions';

// ─── Côté tenant ─────────────────────────────────────────────────────────────
@Controller('support/tickets')
export class TenantSupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @RequirePermission(Permission.SUPPORT_CREATE_TENANT)
  create(
    @CurrentUser() actor: CurrentUserPayload,
    @Body() dto: CreateSupportTicketDto,
  ) {
    return this.support.createByTenant(actor, dto);
  }

  @Get()
  @RequirePermission(Permission.SUPPORT_READ_TENANT)
  list(
    @CurrentUser() actor: CurrentUserPayload,
    @Query('status') status?: SupportStatus,
  ) {
    return this.support.listByTenant(actor.tenantId, status);
  }

  @Get(':id')
  @RequirePermission(Permission.SUPPORT_READ_TENANT)
  findOne(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.support.findByTenant(actor.tenantId, id);
  }

  @Post(':id/messages')
  @RequirePermission(Permission.SUPPORT_CREATE_TENANT)
  reply(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AddSupportMessageDto,
  ) {
    return this.support.addMessageByTenant(actor, id, dto);
  }
}

// ─── Côté plateforme ─────────────────────────────────────────────────────────
@Controller('platform/support/tickets')
export class PlatformSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermission(Permission.PLATFORM_SUPPORT_READ_GLOBAL)
  queue(
    @Query('status') status?: SupportStatus,
    @Query('priority') priority?: SupportPriority,
    @Query('tenantId') tenantId?: string,
    @Query('assignee') assignee?: string,
  ) {
    return this.support.listPlatform({ status, priority, tenantId, assignedToPlatformUserId: assignee });
  }

  @Get(':id')
  @RequirePermission(Permission.PLATFORM_SUPPORT_READ_GLOBAL)
  findOne(@Param('id') id: string) {
    return this.support.findPlatform(id);
  }

  @Patch(':id')
  @RequirePermission(Permission.PLATFORM_SUPPORT_WRITE_GLOBAL)
  update(@Param('id') id: string, @Body() dto: UpdateSupportTicketDto) {
    return this.support.updateByPlatform(id, dto);
  }

  @Post(':id/messages')
  @RequirePermission(Permission.PLATFORM_SUPPORT_WRITE_GLOBAL)
  reply(
    @CurrentUser() actor: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AddSupportMessageDto,
  ) {
    return this.support.addMessageByPlatform(actor, id, dto);
  }
}
