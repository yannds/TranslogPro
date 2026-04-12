import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { DlqService } from './dlq.service';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * DLQ Manager — accès réservé aux opérateurs (SETTINGS_MANAGE_TENANT).
 * Toutes les actions replay/discard sont loggées niveau critical par AuditService.
 */
@Controller('admin/dlq')
export class DlqController {
  constructor(private readonly dlqService: DlqService) {}

  @Get('stats')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  stats() {
    return this.dlqService.getStats();
  }

  @Get('events')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  list(@Query('tenantId') tenantId?: string) {
    return this.dlqService.listPending(tenantId);
  }

  @Post('events/:id/replay')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  replay(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.dlqService.replay(id, actor.id);
  }

  @Post('events/:id/discard')
  @RequirePermission(Permission.SETTINGS_MANAGE_TENANT)
  discard(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.dlqService.discard(id, actor.id);
  }
}
