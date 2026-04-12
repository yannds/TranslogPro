import { Controller, Get, Patch, Param } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('unread')
  @RequirePermission(Permission.NOTIFICATION_READ)
  getUnread(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notificationService.getUnread(tenantId, user.id);
  }

  @Patch(':id/read')
  @RequirePermission(Permission.NOTIFICATION_READ)
  markRead(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.notificationService.markRead(tenantId, id);
  }
}
