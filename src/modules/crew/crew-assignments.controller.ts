import { Controller, Get } from '@nestjs/common';
import { CrewService } from './crew.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/crew-assignments')
export class CrewAssignmentsController {
  constructor(private readonly crewService: CrewService) {}

  @Get('my')
  @RequirePermission(Permission.DRIVER_REST_OWN)
  getMine(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.crewService.getMineUpcoming(tenantId, user.id);
  }
}
