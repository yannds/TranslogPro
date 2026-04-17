/**
 * QuaiController — Endpoints gestion des quais de gare.
 */
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
} from '@nestjs/common';
import { QuaiService } from './quai.service';
import { CreatePlatformDto, UpdatePlatformDto } from './dto/create-platform.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

@Controller({ version: '1', path: 'tenants/:tenantId' })
export class QuaiController {
  constructor(private readonly quais: QuaiService) {}

  @Get('platforms')
  @RequirePermission(Permission.PLATFORM_READ_AGENCY)
  findAll(
    @Param('tenantId')  tenantId:  string,
    @Query('stationId') stationId?: string,
  ) {
    return this.quais.findAll(tenantId, stationId);
  }

  @Get('platforms/:id')
  @RequirePermission(Permission.PLATFORM_READ_AGENCY)
  findOne(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.quais.findOne(tenantId, id);
  }

  @Post('platforms')
  @RequirePermission(Permission.PLATFORM_MANAGE_TENANT)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreatePlatformDto,
  ) {
    return this.quais.create(tenantId, dto);
  }

  @Patch('platforms/:id')
  @RequirePermission(Permission.PLATFORM_MANAGE_TENANT)
  update(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body() dto: UpdatePlatformDto,
  ) {
    return this.quais.update(tenantId, id, dto);
  }

  @Delete('platforms/:id')
  @RequirePermission(Permission.PLATFORM_MANAGE_TENANT)
  remove(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.quais.remove(tenantId, id);
  }

  @Post('platforms/:id/assign')
  @RequirePermission(Permission.PLATFORM_MANAGE_TENANT)
  assignTrip(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
    @Body('tripId')    tripId:   string,
  ) {
    return this.quais.assignTrip(tenantId, id, tripId);
  }

  @Post('platforms/:id/release')
  @RequirePermission(Permission.PLATFORM_MANAGE_TENANT)
  releaseTrip(
    @Param('tenantId') tenantId: string,
    @Param('id')       id:       string,
  ) {
    return this.quais.releaseTrip(tenantId, id);
  }
}
