import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { FeedbackService, SubmitFeedbackDto } from './feedback.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller('tenants/:tenantId/feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @RequirePermission(Permission.FEEDBACK_SUBMIT_OWN)
  submit(
    @TenantId() tenantId: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.feedbackService.submit(tenantId, dto, actor);
  }

  @Get('trip/:tripId')
  @RequirePermission(Permission.STATS_READ_TENANT)
  forTrip(@TenantId() tenantId: string, @Param('tripId') tripId: string) {
    return this.feedbackService.getForTrip(tenantId, tripId);
  }

  @Get('ratings/:entityType/:entityId')
  @RequirePermission(Permission.STATS_READ_TENANT)
  rating(
    @TenantId() tenantId: string,
    @Param('entityType') entityType: string,
    @Param('entityId')   entityId:   string,
  ) {
    return this.feedbackService.getRating(tenantId, entityType, entityId);
  }
}
