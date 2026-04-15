import {
  Controller, Get, Post, Delete, Param, Query, Body, Res,
  UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AttachmentsService, AttachmentEntity, AttachmentKind } from './attachments.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

interface MulterFile {
  fieldname:    string;
  originalname: string;
  mimetype:     string;
  size:         number;
  buffer:       Buffer;
}

const ENTITY_TYPES: AttachmentEntity[] = ['CUSTOMER', 'STAFF', 'VEHICLE', 'TRIP', 'INCIDENT', 'PARCEL'];
const KINDS: AttachmentKind[] = ['CONTRACT', 'ID_CARD', 'LICENSE', 'CERTIFICATE', 'PHOTO', 'OTHER'];

function assertEntity(v: string): asserts v is AttachmentEntity {
  if (!ENTITY_TYPES.includes(v as AttachmentEntity)) {
    throw new BadRequestException(`entityType invalide : ${v}`);
  }
}

function assertKind(v: string): asserts v is AttachmentKind {
  if (!KINDS.includes(v as AttachmentKind)) {
    throw new BadRequestException(`kind invalide : ${v}`);
  }
}

@Controller('tenants/:tenantId/attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @Get()
  @RequirePermission(Permission.CRM_READ_TENANT)
  list(
    @TenantId() tenantId: string,
    @Query('entityType') entityType: string,
    @Query('entityId')   entityId:   string,
  ) {
    assertEntity(entityType);
    if (!entityId) throw new BadRequestException('entityId requis');
    return this.service.list(tenantId, entityType, entityId);
  }

  @Post()
  @RequirePermission(Permission.CRM_READ_TENANT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async upload(
    @TenantId() tenantId: string,
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: MulterFile,
    @Body() body: { entityType: string; entityId: string; kind: string },
  ) {
    if (!file) throw new BadRequestException('Fichier manquant');
    assertEntity(body.entityType);
    assertKind(body.kind);
    if (!body.entityId) throw new BadRequestException('entityId requis');

    return this.service.upload({
      tenantId,
      entityType: body.entityType,
      entityId:   body.entityId,
      kind:       body.kind,
      fileName:   file.originalname,
      mimeType:   file.mimetype,
      buffer:     file.buffer,
      uploadedBy: user.id,
    });
  }

  @Get(':id/download')
  @RequirePermission(Permission.CRM_READ_TENANT)
  async download(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { downloadUrl } = await this.service.getDownloadUrl(tenantId, id);
    res.redirect(302, downloadUrl);
  }

  @Delete(':id')
  @RequirePermission(Permission.CRM_READ_TENANT)
  remove(
    @TenantId() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(tenantId, id);
  }
}
