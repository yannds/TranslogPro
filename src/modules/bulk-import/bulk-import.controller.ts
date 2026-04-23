import {
  Controller, Get, Post, Param, UploadedFile, UseInterceptors, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
import { BulkImportService, BulkEntity } from './bulk-import.service';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { CurrentUser, CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Permission } from '../../common/constants/permissions';

/**
 * Bulk import — génération templates XLSX + import par entité.
 * Tout protégé par BULK_IMPORT_TENANT.
 */
@Controller('tenants/:tenantId/bulk-import')
export class BulkImportController {
  constructor(private readonly svc: BulkImportService) {}

  /**
   * GET /tenants/:tenantId/bulk-import/template/:entity
   * Télécharge le template XLSX pré-formaté pour l'entité demandée.
   */
  @Get('template/:entity')
  @RequirePermission(Permission.BULK_IMPORT_TENANT)
  async downloadTemplate(
    @TenantId() tenantId: string,
    @Param('entity') entity: BulkEntity,
    @Res() res: Response,
  ) {
    const buf = await this.svc.generateTemplate(entity, tenantId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="template_${entity}.xlsx"`);
    res.end(buf);
  }

  /**
   * POST /tenants/:tenantId/bulk-import/import/:entity
   * Importe le fichier XLSX uploadé (multipart/form-data, champ "file").
   * Retourne { total, created, skipped, errors[] }.
   */
  @Post('import/:entity')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.BULK_IMPORT_TENANT)
  @UseInterceptors(FileInterceptor('file'))
  async importFile(
    @TenantId() tenantId: string,
    @CurrentUser() actor: CurrentUserPayload,
    @Param('entity') entity: BulkEntity,
    @UploadedFile() file: MulterFile,
  ) {
    return this.svc.importFile(tenantId, entity, file.buffer, actor.id);
  }
}
