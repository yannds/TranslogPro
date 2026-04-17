/**
 * AnnouncementController — Endpoints annonces gare.
 */
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/create-announcement.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get('announcements')
  @RequirePermission(Permission.ANNOUNCEMENT_READ_AGENCY)
  findAll(
    @Param('tenantId')   tenantId:   string,
    @Query('stationId')  stationId?: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.announcements.findAll(tenantId, stationId, activeOnly === 'true');
  }

  @Get('announcements/:id')
  @RequirePermission(Permission.ANNOUNCEMENT_READ_AGENCY)
  findOne(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.announcements.findOne(tenantId, id);
  }

  @Post('announcements')
  @RequirePermission(Permission.ANNOUNCEMENT_MANAGE_TENANT)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.announcements.create(tenantId, dto);
  }

  @Patch('announcements/:id')
  @RequirePermission(Permission.ANNOUNCEMENT_MANAGE_TENANT)
  update(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body() dto: UpdateAnnouncementDto,
  ) {
    return this.announcements.update(tenantId, id, dto);
  }

  @Delete('announcements/:id')
  @RequirePermission(Permission.ANNOUNCEMENT_MANAGE_TENANT)
  remove(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.announcements.remove(tenantId, id);
  }
}
