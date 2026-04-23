import { Module }             from '@nestjs/common';
import { BackupController }   from './backup.controller';
import { BackupService }      from './backup.service';
import { RestoreService }     from './restore.service';
import { GdprExportService }  from './gdpr-export.service';
import { BackupScopeRegistry } from './backup-scope.registry';

/**
 * BackupModule — backup/restore/RGPD pour chaque tenant.
 *
 * PrismaService, StorageService, PayloadEncryptor et PlatformConfigService
 * sont fournis globalement par leurs modules d'infrastructure respectifs.
 */
@Module({
  controllers: [BackupController],
  providers:   [
    BackupScopeRegistry,
    BackupService,
    RestoreService,
    GdprExportService,
  ],
  exports: [BackupService, GdprExportService],
})
export class BackupModule {}
