import {
  Controller, Get, Post, Delete, Body, Param, HttpCode,
  UseGuards, Put,
} from '@nestjs/common';
import { BackupService }     from './backup.service';
import { RestoreService }    from './restore.service';
import { GdprExportService } from './gdpr-export.service';
import { BackupScopeRegistry } from './backup-scope.registry';
import { RequirePermission }   from '../../common/decorators/require-permission.decorator';
import {
  P_BACKUP_READ_TENANT, P_BACKUP_CREATE_TENANT,
  P_BACKUP_RESTORE_TENANT, P_BACKUP_DELETE_TENANT,
  P_BACKUP_SCHEDULE_TENANT, P_GDPR_EXPORT_TENANT,
} from '../../common/constants/permissions';
import { CurrentUser, type CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import {
  RateLimit, RedisRateLimitGuard,
} from '../../common/guards/redis-rate-limit.guard';
import { IsIn, IsInt, IsBoolean, IsOptional, Min, Max, IsString } from 'class-validator';

class CreateBackupDto {
  @IsIn(['billetterie', 'colis', 'operations', 'full'])
  scopeId!: string;
}

class CreateRestoreDto {
  @IsString()
  jobId!: string;
  @IsIn(['ADDITIVE', 'REPLACE'])
  mode!: 'ADDITIVE' | 'REPLACE';
}

class UpsertScheduleDto {
  @IsBoolean()
  enabled!: boolean;
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  frequency!: string;
  @IsIn(['billetterie', 'colis', 'operations', 'full'])
  scopeId!: string;
  @IsInt() @Min(0) @Max(23)
  hourUtc!: number;
  @IsOptional() @IsInt() @Min(0) @Max(6)
  dayOfWeek?: number;
  @IsOptional() @IsInt() @Min(1) @Max(28)
  dayOfMonth?: number;
  @IsInt() @Min(1) @Max(365)
  retainCount!: number;
}

/**
 * Endpoints backup/restore/RGPD pour tenant-admin.
 *
 *   GET    /api/v1/backup/scopes           — catalogue des scopes disponibles
 *   GET    /api/v1/backup/jobs             — liste des backups
 *   POST   /api/v1/backup/jobs             — déclencher un backup
 *   GET    /api/v1/backup/jobs/:id         — détail + manifest
 *   DELETE /api/v1/backup/jobs/:id         — supprimer les fichiers MinIO
 *   POST   /api/v1/backup/restores         — déclencher une restauration
 *   GET    /api/v1/backup/restores         — liste des restaurations
 *   GET    /api/v1/backup/schedule         — config planification
 *   PUT    /api/v1/backup/schedule         — upsert planification
 *   GET    /api/v1/backup/gdpr             — liste des exports RGPD
 *   POST   /api/v1/backup/gdpr             — déclencher un export RGPD
 *   GET    /api/v1/backup/gdpr/:id/url     — lien présigné de téléchargement
 */
@Controller({ version: '1', path: 'backup' })
export class BackupController {
  constructor(
    private readonly backupService:  BackupService,
    private readonly restoreService: RestoreService,
    private readonly gdprService:    GdprExportService,
    private readonly scopeRegistry:  BackupScopeRegistry,
  ) {}

  // ── Scopes ──────────────────────────────────────────────────────────────────

  @Get('scopes')
  @RequirePermission(P_BACKUP_READ_TENANT)
  getScopes() {
    return this.scopeRegistry.getAll().map(s => ({
      id:          s.id,
      labelKey:    s.label,
      descKey:     s.description,
      tableCount:  s.rootTables.length,
      minio:       s.minioEntityTypes.length > 0 || s.id === 'full',
    }));
  }

  // ── Backups ──────────────────────────────────────────────────────────────────

  @Get('jobs')
  @RequirePermission(P_BACKUP_READ_TENANT)
  listJobs(@CurrentUser() user: CurrentUserPayload) {
    return this.backupService.list(user.tenantId);
  }

  @Post('jobs')
  @HttpCode(202)
  @RequirePermission(P_BACKUP_CREATE_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 3_600_000, keyBy: 'tenantId', suffix: 'backup_create' })
  createJob(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateBackupDto,
  ) {
    return this.backupService.create(user.tenantId, dto.scopeId, user.id);
  }

  @Get('jobs/:id')
  @RequirePermission(P_BACKUP_READ_TENANT)
  getJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.backupService.findOne(user.tenantId, id);
  }

  @Get('jobs/:id/manifest')
  @RequirePermission(P_BACKUP_READ_TENANT)
  getManifest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.backupService.getManifest(user.tenantId, id);
  }

  @Delete('jobs/:id')
  @HttpCode(204)
  @RequirePermission(P_BACKUP_DELETE_TENANT)
  deleteJob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.backupService.softDelete(user.tenantId, id);
  }

  // ── Restaurations ────────────────────────────────────────────────────────────

  @Get('restores')
  @RequirePermission(P_BACKUP_READ_TENANT)
  listRestores(@CurrentUser() user: CurrentUserPayload) {
    return this.restoreService.list(user.tenantId);
  }

  @Post('restores')
  @HttpCode(202)
  @RequirePermission(P_BACKUP_RESTORE_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 3_600_000, keyBy: 'tenantId', suffix: 'backup_restore' })
  createRestore(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateRestoreDto,
  ) {
    return this.restoreService.create(user.tenantId, dto.jobId, dto.mode, user.id);
  }

  // ── Planification ────────────────────────────────────────────────────────────

  @Get('schedule')
  @RequirePermission(P_BACKUP_SCHEDULE_TENANT)
  getSchedule(@CurrentUser() user: CurrentUserPayload) {
    return this.backupService.getSchedule(user.tenantId);
  }

  @Put('schedule')
  @RequirePermission(P_BACKUP_SCHEDULE_TENANT)
  upsertSchedule(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpsertScheduleDto,
  ) {
    return this.backupService.upsertSchedule(user.tenantId, dto);
  }

  // ── RGPD ─────────────────────────────────────────────────────────────────────

  @Get('gdpr')
  @RequirePermission(P_GDPR_EXPORT_TENANT)
  listGdprJobs(@CurrentUser() user: CurrentUserPayload) {
    return this.gdprService.list(user.tenantId);
  }

  @Post('gdpr')
  @HttpCode(202)
  @RequirePermission(P_GDPR_EXPORT_TENANT)
  @UseGuards(RedisRateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 86_400_000, keyBy: 'tenantId', suffix: 'gdpr_export' })
  createGdprExport(@CurrentUser() user: CurrentUserPayload) {
    return this.gdprService.create(user.tenantId, user.id);
  }

  @Get('gdpr/:id/url')
  @RequirePermission(P_GDPR_EXPORT_TENANT)
  getGdprDownloadUrl(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.gdprService.getDownloadUrl(user.tenantId, id);
  }
}
