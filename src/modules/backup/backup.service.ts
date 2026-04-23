/**
 * BackupService — orchestration des sauvegardes tenant.
 *
 * Cycle de vie d'un BackupJob :
 *   PENDING → CAPTURING → UPLOADING → SEALING → COMPLETED
 *                                              ↘ FAILED (rollback MinIO)
 *
 * Atomicité :
 *   Phase 1 (CAPTURING) : lecture DB + inventaire MinIO (non bloquant)
 *   Phase 2 (UPLOADING) : upload DB dump + copie fichiers MinIO
 *     → si l'un échoue → removeObjectsByPrefix + status=FAILED
 *   Phase 3 (SEALING)  : écriture manifest.json + status=COMPLETED
 *
 * Anti-abus inter-tenants :
 *   Le manifest embarque un watermark chiffré AES-256-GCM contenant
 *   { tenantId, scopeId, exportedAt, planTier, subscriptionStatus }.
 *   À l'import, RestoreService vérifie ce watermark.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { IStorageService, STORAGE_SERVICE } from '../../infrastructure/storage/interfaces/storage.interface';
import { PayloadEncryptor } from '../../infrastructure/payment/payload-encryptor.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { BackupScopeRegistry } from './backup-scope.registry';

export interface BackupManifest {
  jobId:           string;
  scopeId:         string;
  resolvedTables:  string[];
  rowCounts:       Record<string, number>;
  fileIndex:       { key: string; sha256: string; entityType: string }[];
  schemaVersion:   string;
  tenantId:        string;
  planTier:        string;
  subscriptionStatus: string;
  exportedAt:      string;
  watermark:       string;  // AES-256-GCM chiffré
  sourceExportId:  string;  // UUID unique par archive (anti-doublon import)
}

@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);

  constructor(
    private readonly prisma:         PrismaService,
    @Inject(STORAGE_SERVICE)
    private readonly storage:        IStorageService,
    private readonly encryptor:      PayloadEncryptor,
    private readonly platformConfig: PlatformConfigService,
    private readonly scopeRegistry:  BackupScopeRegistry,
  ) {}

  // ── Lister les backups d'un tenant ──────────────────────────────────────────

  async list(tenantId: string) {
    return this.prisma.backupJob.findMany({
      where:   { tenantId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take:    50,
      select: {
        id: true, scopeId: true, status: true, schemaVersion: true,
        sizeBytes: true, storagePath: true, phase: true, phaseProgress: true,
        scheduledBy: true, startedAt: true, completedAt: true, createdAt: true,
        rowCounts: true, resolvedTables: true,
        _count: { select: { restores: true } },
      },
    });
  }

  async findOne(tenantId: string, jobId: string) {
    const job = await this.prisma.backupJob.findFirst({
      where: { id: jobId, tenantId, deletedAt: null },
    });
    if (!job) throw new NotFoundException('Backup introuvable');
    return job;
  }

  // ── Déclencher un nouveau backup ─────────────────────────────────────────────

  async create(tenantId: string, scopeId: string, initiatedBy: string) {
    const scope = this.scopeRegistry.get(scopeId);
    if (!scope) throw new BadRequestException(`Scope inconnu : ${scopeId}`);

    await this.checkExportQuota(tenantId);

    const job = await this.prisma.backupJob.create({
      data: {
        tenantId,
        scopeId,
        status:      'PENDING',
        scheduledBy: `user:${initiatedBy}`,
      },
    });

    // Exécution asynchrone — on ne bloque pas la réponse HTTP
    this.runBackup(job.id, tenantId, scopeId).catch(err => {
      this.log.error(`Backup ${job.id} FAILED : ${(err as Error).message}`);
    });

    return { jobId: job.id, status: 'PENDING' };
  }

  // ── Supprimer les fichiers d'un backup (garder l'entrée log) ────────────────

  async softDelete(tenantId: string, jobId: string) {
    const job = await this.findOne(tenantId, jobId);
    if (job.storagePath) {
      await this.storage.removeObjectsByPrefix(tenantId, job.storagePath);
      this.log.log(`Backup ${jobId} fichiers MinIO supprimés (${job.storagePath})`);
    }
    await this.prisma.backupJob.update({
      where: { id: jobId },
      data:  { deletedAt: new Date(), status: 'DELETED', storagePath: null },
    });
  }

  // ── Lire le manifest d'un backup ────────────────────────────────────────────

  async getManifest(tenantId: string, jobId: string): Promise<BackupManifest> {
    const job = await this.findOne(tenantId, jobId);
    if (job.status !== 'COMPLETED' || !job.manifest) {
      throw new BadRequestException('Backup non complété ou manifest absent');
    }
    return job.manifest as unknown as BackupManifest;
  }

  // ── Planification ────────────────────────────────────────────────────────────

  async getSchedule(tenantId: string) {
    return this.prisma.backupSchedule.findUnique({ where: { tenantId } });
  }

  async upsertSchedule(
    tenantId: string,
    data: {
      enabled: boolean; frequency: string; scopeId: string;
      hourUtc: number; dayOfWeek?: number; dayOfMonth?: number; retainCount: number;
    },
  ) {
    return this.prisma.backupSchedule.upsert({
      where:  { tenantId },
      update: { ...data, updatedAt: new Date() },
      create: { tenantId, ...data },
    });
  }

  // ── Cron : exécution des backups planifiés ───────────────────────────────────

  async runScheduled(): Promise<void> {
    const now = new Date();
    const schedules = await this.prisma.backupSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
    });
    for (const sched of schedules) {
      this.log.log(`[cron] Backup planifié tenant=${sched.tenantId} scope=${sched.scopeId}`);
      try {
        await this.create(sched.tenantId, sched.scopeId, 'cron');
        await this.prisma.backupSchedule.update({
          where: { tenantId: sched.tenantId },
          data:  { lastRunAt: now, nextRunAt: this.nextRunAt(sched) },
        });
        await this.pruneOldBackups(sched.tenantId, sched.retainCount);
      } catch (e) {
        this.log.error(`[cron] Backup planifié ${sched.tenantId} KO : ${(e as Error).message}`);
      }
    }
  }

  // ── Exécution effective (privé) ──────────────────────────────────────────────

  private async runBackup(jobId: string, tenantId: string, scopeId: string): Promise<void> {
    const storagePath = `backups/${tenantId}/${jobId}`;

    try {
      // ── Phase 1 : CAPTURING ──────────────────────────────────────────────────
      await this.updateJob(jobId, { status: 'CAPTURING', phase: 'CAPTURING', startedAt: new Date() });

      const resolvedTables = scopeId === 'full'
        ? await this.resolveAllTenantTables()
        : this.scopeRegistry.resolveTablesOrdered(scopeId);

      const rowCounts: Record<string, number> = {};
      const tableDataMap = new Map<string, unknown[]>();

      for (const table of resolvedTables) {
        try {
          const rows = await (this.prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<unknown[]> }>)
            [this.toCamelCase(table)]
            ?.findMany({ where: { tenantId } }) ?? [];
          tableDataMap.set(table, rows);
          rowCounts[table] = rows.length;
        } catch {
          rowCounts[table] = 0;
          tableDataMap.set(table, []);
        }
      }

      // Inventaire MinIO
      const minioEntityTypes = this.scopeRegistry.resolveMinioEntityTypes(scopeId);
      const allMinioObjects  = minioEntityTypes === null
        ? await this.storage.listObjects(tenantId)
        : await this.listMinioByEntityTypes(tenantId, minioEntityTypes);

      // ── Phase 2 : UPLOADING ──────────────────────────────────────────────────
      await this.updateJob(jobId, { status: 'UPLOADING', phase: 'UPLOADING_DB', phaseProgress: 0 });

      // Upload DB dump
      for (let i = 0; i < resolvedTables.length; i++) {
        const table = resolvedTables[i];
        const rows  = tableDataMap.get(table) ?? [];
        const buf   = Buffer.from(JSON.stringify(rows, null, 0), 'utf8');
        const key   = `${storagePath}/db/${String(i + 1).padStart(3, '0')}_${table}.json`;
        await this.storage.putObject(tenantId, key, buf, 'application/json');
        const progress = Math.round(((i + 1) / resolvedTables.length) * 50);
        await this.updateJob(jobId, { phaseProgress: progress });
      }

      await this.updateJob(jobId, { phase: 'UPLOADING_FILES', phaseProgress: 50 });

      // Copie fichiers MinIO + calcul sha256
      const fileIndex: BackupManifest['fileIndex'] = [];
      for (let i = 0; i < allMinioObjects.length; i++) {
        const obj = allMinioObjects[i];
        const buf = await this.storage.getObject(tenantId, obj.key);
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const destKey = `${storagePath}/files/${obj.key}`;
        await this.storage.putObject(tenantId, destKey, buf, 'application/octet-stream');
        fileIndex.push({ key: obj.key, sha256, entityType: this.guessEntityType(obj.key) });
        const progress = 50 + Math.round(((i + 1) / Math.max(allMinioObjects.length, 1)) * 40);
        if (i % 10 === 0) await this.updateJob(jobId, { phaseProgress: progress });
      }

      // ── Phase 3 : SEALING ───────────────────────────────────────────────────
      await this.updateJob(jobId, { status: 'SEALING', phase: 'SEALING', phaseProgress: 90 });

      const sub = await this.prisma.platformSubscription.findUnique({
        where:  { tenantId },
        select: { status: true, planId: true, plan: { select: { slug: true } } },
      });
      const planTier          = (sub?.plan as { slug?: string } | null)?.slug ?? 'unknown';
      const subscriptionStatus = sub?.status ?? 'unknown';
      const schemaVersion      = await this.getCurrentSchemaVersion();
      const sourceExportId     = randomBytes(16).toString('hex');

      const watermarkPayload = JSON.stringify({
        tenantId, scopeId, exportedAt: new Date().toISOString(),
        planTier, subscriptionStatus, sourceExportId,
      });
      const watermark = await this.encryptor.encrypt(watermarkPayload);

      const manifest: BackupManifest = {
        jobId, scopeId, resolvedTables, rowCounts, fileIndex,
        schemaVersion, tenantId, planTier, subscriptionStatus,
        exportedAt:  new Date().toISOString(),
        watermark,
        sourceExportId,
      };

      const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
      await this.storage.putObject(
        tenantId,
        `${storagePath}/manifest.json`,
        manifestBuf,
        'application/json',
      );

      const totalSize = BigInt(manifestBuf.length)
        + Object.values(rowCounts).reduce((acc, c) => acc + BigInt(c * 200), 0n);

      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED', phase: null, phaseProgress: 100,
          resolvedTables, rowCounts, fileIndex: fileIndex as unknown as never,
          schemaVersion, storagePath, manifest: manifest as unknown as never,
          sizeBytes: totalSize, completedAt: new Date(),
        },
      });

      this.log.log(`Backup ${jobId} COMPLETED tables=${resolvedTables.length} files=${fileIndex.length}`);

    } catch (err) {
      this.log.error(`Backup ${jobId} FAILED — rollback MinIO : ${(err as Error).message}`);
      // Rollback : supprimer tout ce qui a été uploadé
      try {
        await this.storage.removeObjectsByPrefix(tenantId, storagePath);
      } catch (cleanupErr) {
        this.log.warn(`Backup ${jobId} cleanup partiel : ${(cleanupErr as Error).message}`);
      }
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED', phase: null,
          errorMessage: (err as Error).message,
        },
      });
    }
  }

  // ── Helpers privés ───────────────────────────────────────────────────────────

  private async updateJob(jobId: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.backupJob.update({ where: { id: jobId }, data });
  }

  private async checkExportQuota(tenantId: string): Promise<void> {
    const maxPerMonth = await this.platformConfig.getNumber('backup.maxExportsPerMonth');
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const count = await this.prisma.backupJob.count({
      where: { tenantId, createdAt: { gte: startOfMonth }, status: { not: 'FAILED' } },
    });
    if (count >= maxPerMonth) {
      throw new ForbiddenException(`Quota exports atteint (${maxPerMonth}/mois)`);
    }
  }

  private async resolveAllTenantTables(): Promise<string[]> {
    // Récupère toutes les tables du schéma public qui ont une colonne tenantId
    const result = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT DISTINCT c.table_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.column_name = 'tenantId'
      ORDER BY c.table_name
    `;
    return result.map(r => r.table_name);
  }

  private async listMinioByEntityTypes(tenantId: string, types: string[]): Promise<{ key: string }[]> {
    const all = await this.storage.listObjects(tenantId);
    // Les clés MinIO contiennent le type dans leur chemin : ex. "ticket/xxx.pdf"
    return all.filter(o => types.some(t => o.key.includes(`/${t}/`) || o.key.startsWith(`${t}/`)));
  }

  private guessEntityType(key: string): string {
    const parts = key.split('/');
    return parts.length > 1 ? (parts[0] ?? 'unknown') : 'unknown';
  }

  private toCamelCase(table: string): string {
    return table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  private async getCurrentSchemaVersion(): Promise<string> {
    try {
      const result = await this.prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC LIMIT 1
      `;
      return result[0]?.migration_name ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async pruneOldBackups(tenantId: string, retainCount: number): Promise<void> {
    const jobs = await this.prisma.backupJob.findMany({
      where:   { tenantId, status: 'COMPLETED', deletedAt: null },
      orderBy: { completedAt: 'desc' },
      select:  { id: true },
    });
    const toDelete = jobs.slice(retainCount);
    for (const job of toDelete) {
      await this.softDelete(tenantId, job.id).catch(() => {});
    }
  }

  private nextRunAt(sched: { frequency: string; hourUtc: number; dayOfWeek?: number | null; dayOfMonth?: number | null }): Date {
    const next = new Date();
    next.setUTCHours(sched.hourUtc, 0, 0, 0);
    if (sched.frequency === 'DAILY') {
      next.setUTCDate(next.getUTCDate() + 1);
    } else if (sched.frequency === 'WEEKLY') {
      const targetDay = sched.dayOfWeek ?? 0;
      const daysUntil = ((targetDay - next.getUTCDay()) + 7) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + daysUntil);
    } else {
      // MONTHLY
      next.setUTCMonth(next.getUTCMonth() + 1);
      if (sched.dayOfMonth) next.setUTCDate(sched.dayOfMonth);
    }
    return next;
  }
}
