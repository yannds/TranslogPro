import {
  Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import {
  AgencyService, CreateAgencyDto, UpdateAgencyDto,
} from './agency.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * CRUD des agences — scope `.tenant`.
 * Protège l'invariant "tout tenant ≥1 agence" via AgencyService.remove() (409).
 */
@Controller('tenants/:tenantId/agencies')
export class AgencyController {
  constructor(private readonly agencies: AgencyService) {}

  @Get()
  @RequirePermission(Permission.AGENCY_READ_TENANT)
  findAll(@TenantId() tenantId: string) {
    return this.agencies.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(Permission.AGENCY_READ_TENANT)
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.agencies.findOne(tenantId, id);
  }

  @Post()
  @RequirePermission(Permission.AGENCY_MANAGE_TENANT)
  create(@TenantId() tenantId: string, @Body() dto: CreateAgencyDto) {
    return this.agencies.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermission(Permission.AGENCY_MANAGE_TENANT)
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAgencyDto,
  ) {
    return this.agencies.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.AGENCY_MANAGE_TENANT)
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.agencies.remove(tenantId, id);
  }
}
