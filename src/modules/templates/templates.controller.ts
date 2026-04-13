import {
  Controller, Get, Post, Put, Delete, Param, Body,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { TemplatesService }                from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/create-template.dto';
import { PermissionGuard }                 from '../../core/iam/guards/permission.guard';
import { RequirePermission }               from '../../common/decorators/require-permission.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { Permission }                      from '../../common/constants/permissions';

@UseGuards(PermissionGuard)
@Controller('tenants/:tenantId/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post()
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateTemplateDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.create(tenantId, dto, actor);
  }

  @Get()
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  findAll(@Param('tenantId') tenantId: string) {
    return this.templates.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(Permission.TEMPLATE_READ_AGENCY)
  findOne(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.findOne(tenantId, id);
  }

  @Put(':id')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.templates.update(tenantId, id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TEMPLATE_DELETE_AGENCY)
  remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.remove(tenantId, id);
  }

  /** URL présignée pour uploader la source .hbs directement vers MinIO */
  @Get(':id/upload-url')
  @RequirePermission(Permission.TEMPLATE_WRITE_AGENCY)
  getUploadUrl(@Param('tenantId') tenantId: string, @Param('id') id: string) {
    return this.templates.getUploadUrl(tenantId, id);
  }
}
