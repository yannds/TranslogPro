/**
 * RestoreService — restauration d'un BackupJob.
 *
 * Modes :
 *   ADDITIVE : upsert idempotent (INSERT … ON CONFLICT DO NOTHING)
 *   REPLACE  : vide le scope avant de réinsérer (opération destructive,
 *              confirmation UI obligatoire)
 *
 * Sécurité anti-abus :
 *   - Vérifie le watermark chiffré du manifest (AES-256-GCM)
 *   - Rejette si planTier=TRIAL dans la source (trial → trial = clonage gratuit)
 *   - Rejette si sourceExportId déjà utilisé sur un autre tenant
 *
 * Atomicité :
 *   - Toutes les insertions DB se font dans une transaction Prisma
 *   - Si la transaction échoue → rollback auto + status=FAILED
 *   - Les fichiers MinIO restaurés sont supprimés si la transaction échoue
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE } from '../../infrastructure/storage/interfaces/storage.interface';
import { PayloadEncryptor } from '../../infrastructure/payment/payload-encryptor.service';
import type { BackupManifest } from './backup.service';

const BLOCKED_PLAN_TIERS = ['TRIAL', 'FREE'];

@Injectable()
export class RestoreService {
  private readonly log = new Logger(RestoreService.name);

  constructor(
    private readonly prisma:    PrismaService,
    @Inject(STORAGE_SERVICE)
    private readonly storage:   IStorageService,
    private readonly encryptor: PayloadEncryptor,
  ) {}

  // ── Lister les restaurations d'un tenant ────────────────────────────────────

  async list(tenantId: string) {
    return this.prisma.backupRestore.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
      take:    30,
      include: { backupJob: { select: { scopeId: true, completedAt: true } } },
    });
  }

  // ── Déclencher une restauration ──────────────────────────────────────────────

  async create(
    tenantId:   string,
    jobId:      string,
    mode:       'ADDITIVE' | 'REPLACE',
    initiatedBy: string,
  ) {
    const job = await this.prisma.backupJob.findFirst({
      where: { id: jobId, status: 'COMPLETED', deletedAt: null },
    });
    if (!job) throw new NotFoundException('Backup introuvable ou non complété');

    const manifest = job.manifest as unknown as BackupManifest;
    if (!manifest?.watermark) throw new BadRequestException('Manifest invalide (watermark absent)');

    // Vérification watermark
    await this.verifyWatermark(manifest, tenantId);

    const restore = await this.prisma.backupRestore.create({
      data: { tenantId, backupJobId: jobId, mode, status: 'PENDING', initiatedBy },
    });

    // Exécution asynchrone
    this.runRestore(restore.id, tenantId, job.storagePath!, manifest, mode).catch(err => {
      this.log.error(`Restore ${restore.id} FAILED : ${(err as Error).message}`);
    });

    return { restoreId: restore.id, status: 'PENDING' };
  }

  // ── Exécution effective ──────────────────────────────────────────────────────

  private async runRestore(
    restoreId:    string,
    tenantId:     string,
    storagePath:  string,
    manifest:     BackupManifest,
    mode:         'ADDITIVE' | 'REPLACE',
  ): Promise<void> {
    const restoredFiles: string[] = [];

    try {
      await this.prisma.backupRestore.update({
        where: { id: restoreId },
        data:  { status: 'RUNNING', startedAt: new Date() },
      });

      // ── Restauration fichiers MinIO ──────────────────────────────────────────
      for (const fileEntry of manifest.fileIndex) {
        const srcKey  = `${storagePath}/files/${fileEntry.key}`;
        const destKey = fileEntry.key;
        try {
          const buf = await this.storage.getObject(tenantId, srcKey);
          await this.storage.putObject(tenantId, destKey, buf, 'application/octet-stream');
          restoredFiles.push(destKey);
        } catch (e) {
          this.log.warn(`Restore ${restoreId} : fichier ${fileEntry.key} ignoré — ${(e as Error).message}`);
        }
      }

      // ── Restauration DB (transaction atomique) ───────────────────────────────
      const restoredTables: string[] = [];

      await this.prisma.$transaction(async (tx) => {
        if (mode === 'REPLACE') {
          // En mode REPLACE : vider les tables dans l'ordre inverse (enfants d'abord)
          for (const table of [...manifest.resolvedTables].reverse()) {
            try {
              await (tx as unknown as Record<string, { deleteMany: (args: unknown) => Promise<unknown> }>)
                [this.toCamelCase(table)]
                ?.deleteMany({ where: { tenantId } });
            } catch {
              // Table non gérée par Prisma — ignorer
            }
          }
        }

        // Insérer dans l'ordre topologique (parents d'abord)
        for (const table of manifest.resolvedTables) {
          const dataKey = `${storagePath}/db/${manifest.resolvedTables.indexOf(table) + 1}_${table}.json`;
          let rows: unknown[] = [];
          try {
            const buf = await this.storage.getObject(tenantId, dataKey);
            rows = JSON.parse(buf.toString('utf8')) as unknown[];
          } catch {
            continue; // fichier absent pour ce scope — normal
          }

          if (rows.length === 0) continue;

          const model = (tx as unknown as Record<string, { createMany: (args: unknown) => Promise<unknown> }>)
            [this.toCamelCase(table)];
          if (!model) continue;

          // ADDITIVE : skipDuplicates ignore les conflits de PK
          await model.createMany({ data: rows, skipDuplicates: true });
          restoredTables.push(table);
        }
      });

      // Marquer la sourceExportId comme utilisée (anti-doublon)
      await this.markSourceUsed(manifest.sourceExportId, tenantId, restoreId);

      await this.prisma.backupRestore.update({
        where: { id: restoreId },
        data: {
          status: 'COMPLETED',
          restoredTables,
          filesRestored: restoredFiles.length,
          completedAt: new Date(),
        },
      });

      this.log.log(`Restore ${restoreId} COMPLETED tables=${restoredTables.length} files=${restoredFiles.length}`);

    } catch (err) {
      this.log.error(`Restore ${restoreId} FAILED : ${(err as Error).message}`);

      // Rollback MinIO : supprimer les fichiers déjà restaurés
      for (const key of restoredFiles) {
        await this.storage.deleteObject(tenantId, key).catch(() => {});
      }

      await this.prisma.backupRestore.update({
        where: { id: restoreId },
        data: {
          status: 'FAILED',
          errorMessage: (err as Error).message,
        },
      });
    }
  }

  // ── Vérification watermark anti-abus ────────────────────────────────────────

  private async verifyWatermark(manifest: BackupManifest, targetTenantId: string): Promise<void> {
    let payload: {
      tenantId: string; scopeId: string; planTier: string;
      subscriptionStatus: string; sourceExportId: string;
    };

    try {
      payload = JSON.parse(await this.encryptor.decrypt(manifest.watermark)) as typeof payload;
    } catch {
      throw new ForbiddenException('Watermark invalide ou corrompu');
    }

    // Un backup d'un tenant ne peut être restauré que sur le même tenant
    if (payload.tenantId !== targetTenantId) {
      throw new ForbiddenException('Ce backup appartient à un autre tenant');
    }

    // Anti-clonage : bloquer les imports depuis un plan gratuit/trial
    if (BLOCKED_PLAN_TIERS.includes(payload.planTier)) {
      throw new ForbiddenException(
        `Restauration bloquée : le backup source était sur un plan ${payload.planTier}`,
      );
    }

    // Vérifier qu'on n'importe pas deux fois le même export
    const alreadyUsed = await this.prisma.backupRestore.findFirst({
      where: {
        tenantId:   { not: targetTenantId },
        backupJob: { manifest: { path: ['sourceExportId'], equals: payload.sourceExportId } },
        status: 'COMPLETED',
      },
    });
    if (alreadyUsed) {
      this.log.warn(
        `ALERTE anti-abus : sourceExportId ${payload.sourceExportId} déjà utilisé sur tenant ${alreadyUsed.tenantId}`,
      );
      throw new ForbiddenException('Ce backup a déjà été importé sur un autre tenant');
    }
  }

  private async markSourceUsed(sourceExportId: string, tenantId: string, restoreId: string): Promise<void> {
    // On log l'utilisation dans un champ metadata de la restauration
    await this.prisma.backupRestore.update({
      where: { id: restoreId },
      data:  { initiatedBy: `${await this.getInitiator(restoreId)}|src:${sourceExportId}` },
    }).catch(() => {});
  }

  private async getInitiator(restoreId: string): Promise<string> {
    const r = await this.prisma.backupRestore.findUnique({ where: { id: restoreId }, select: { initiatedBy: true } });
    return r?.initiatedBy ?? 'unknown';
  }

  private toCamelCase(table: string): string {
    return table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }
}
