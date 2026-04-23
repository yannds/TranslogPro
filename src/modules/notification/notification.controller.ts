import { Body, Controller, Get, Patch, Param } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { ScopeCtx, ScopeContext } from '../../common/decorators/scope-context.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('unread')
  @RequirePermission(Permission.NOTIFICATION_READ_OWN)
  getUnread(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notificationService.getUnread(tenantId, user.id);
  }

  @Patch(':id/read')
  @RequirePermission(Permission.NOTIFICATION_READ_OWN)
  markRead(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @ScopeCtx() scope: ScopeContext,
  ) {
    return this.notificationService.markRead(tenantId, id, scope);
  }

  /**
   * Préférences de notifications de l'utilisateur courant (Module L PRD).
   * Identité forcée serveur (CurrentUser) — jamais lue depuis le payload.
   * Pas de permission "preferences.write" séparée : si tu peux lire tes
   * propres notifications, tu peux gérer tes propres canaux.
   */
  @Get('preferences')
  @RequirePermission(Permission.NOTIFICATION_READ_OWN)
  getPreferences(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.notificationService.getPreferences(tenantId, user.id);
  }

  @Patch('preferences')
  @RequirePermission(Permission.NOTIFICATION_READ_OWN)
  updatePreferences(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationService.upsertPreferences(tenantId, user.id, dto);
  }
}
