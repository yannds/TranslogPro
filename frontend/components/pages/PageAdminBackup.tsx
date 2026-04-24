/**
 * PageAdminBackup — /admin/settings/backup
 *
 * 3 sections :
 *   1. Sauvegardes — liste DataTableMaster, nouveau backup, restaurer, supprimer
 *   2. Planification — toggle + fréquence + scope + rétention
 *   3. Export RGPD — déclencher + historique + téléchargement
 *
 * Desktop-first, max-w-5xl. Dark + Light. i18n fr/en.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  HardDrive, Download, RefreshCw, Plus, Trash2, RotateCcw,
  Calendar, Shield, AlertTriangle, CheckCircle2,
  Loader2, ChevronDown, ChevronRight, Info,
} from 'lucide-react';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n }            from '../../lib/i18n/useI18n';
import { cn }                 from '../../lib/utils';
import { Dialog }             from '../ui/Dialog';
import { Button }             from '../ui/Button';

// ── Types ────────────────────────────────────────────────────────────────────

interface BackupScope {
  id: string; labelKey: string; descKey: string; tableCount: number; minio: boolean;
}
interface BackupJob {
  id: string; scopeId: string; status: string; schemaVersion: string | null;
  sizeBytes: string | null; storagePath: string | null;
  phase: string | null; phaseProgress: number | null;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  rowCounts: Record<string, number>; resolvedTables: string[];
  _count: { restores: number };
}
interface RestoreJob {
  id: string; backupJobId: string; mode: string; status: string;
  restoredTables: string[]; filesRestored: number;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  backupJob: { scopeId: string; completedAt: string | null };
}
interface BackupSchedule {
  enabled: boolean; frequency: string; scopeId: string;
  hourUtc: number; dayOfWeek: number | null; dayOfMonth: number | null;
  retainCount: number; lastRunAt: string | null; nextRunAt: string | null;
}
interface GdprJob {
  id: string; status: string; sizeBytes: string | null;
  downloadUrl: string | null; expiresAt: string | null;
  entityCounts: Record<string, number>;
  startedAt: string | null; completedAt: string | null; createdAt: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PageAdminBackup() {
  const { t, lang }  = useI18n();
  const dateFmt = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const [scopes,    setScopes]    = useState<BackupScope[]>([]);
  const [jobs,      setJobs]      = useState<BackupJob[]>([]);
  const [restores,  setRestores]  = useState<RestoreJob[]>([]);
  const [schedule,  setSchedule]  = useState<BackupSchedule | null>(null);
  const [gdprJobs,  setGdprJobs]  = useState<GdprJob[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Dialog states
  const [newBackupOpen,  setNewBackupOpen]  = useState(false);
  const [restoreTarget,  setRestoreTarget]  = useState<BackupJob | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<BackupJob | null>(null);
  const [scheduleOpen,   setScheduleOpen]   = useState(false);
  const [expandedJob,    setExpandedJob]    = useState<string | null>(null);

  async function loadAll() {
    setLoading(true); setError(null);
    try {
      const [s, j, r, sc, g] = await Promise.all([
        apiFetch<BackupScope[]>('/api/backup/scopes'),
        apiFetch<BackupJob[]>('/api/backup/jobs'),
        apiFetch<RestoreJob[]>('/api/backup/restores'),
        apiFetch<BackupSchedule | null>('/api/backup/schedule').catch(() => null),
        apiFetch<GdprJob[]>('/api/backup/gdpr'),
      ]);
      setScopes(s); setJobs(j); setRestores(r);
      setSchedule(sc ?? null); setGdprJobs(g);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('backup.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  if (loading) return (
    <div className="flex items-center justify-center p-16 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
      <p className="text-sm text-slate-600 dark:text-slate-400">{error}</p>
      <Button onClick={loadAll} leftIcon={<RefreshCw className="h-4 w-4" aria-hidden />}>
        {t('common.retry')}
      </Button>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 p-4 sm:p-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400">
          <HardDrive className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('backup.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('backup.subtitle')}</p>
        </div>
      </header>

      {/* Banner job en cours */}
      {jobs.some(j => ['CAPTURING','UPLOADING','SEALING'].includes(j.status)) && (
        <ActiveBackupBanner jobs={jobs} t={t} />
      )}

      {/* ── Section 1 : Sauvegardes ─────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('backup.section.jobs')}
          </h2>
          <Button
            onClick={() => setNewBackupOpen(true)}
            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            size="sm"
          >
            {t('backup.new')}
          </Button>
        </div>

        {jobs.length === 0 ? (
          <EmptyState icon={HardDrive} label={t('backup.empty')} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
            {jobs.map(job => (
              <BackupJobRow
                key={job.id}
                job={job}
                scopes={scopes}
                dateFmt={dateFmt}
                expanded={expandedJob === job.id}
                onToggle={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
                onRestore={() => setRestoreTarget(job)}
                onDelete={() => setDeleteTarget(job)}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2 : Restaurations ───────────────────────────────── */}
      {restores.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {t('backup.section.restores')}
          </h2>
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
            {restores.slice(0, 10).map(r => (
              <RestoreRow key={r.id} restore={r} dateFmt={dateFmt} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* ── Section 3 : Planification ───────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {t('backup.section.schedule')}
          </h2>
          <Button
            onClick={() => setScheduleOpen(true)}
            leftIcon={<Calendar className="h-4 w-4" aria-hidden />}
            variant="outline"
            size="sm"
          >
            {t('backup.schedule.configure')}
          </Button>
        </div>
        <ScheduleSummary schedule={schedule} dateFmt={dateFmt} t={t} scopes={scopes} />
      </section>

      {/* ── Section 4 : Export RGPD ─────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {t('backup.section.gdpr')}
            </h2>
            <div className="group relative">
              <Info className="h-3.5 w-3.5 text-slate-400 cursor-help" aria-hidden />
              <div className="absolute left-5 top-0 z-10 hidden group-hover:block w-64 rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {t('backup.gdpr.tooltip')}
              </div>
            </div>
          </div>
          <GdprTriggerButton onCreated={loadAll} t={t} />
        </div>

        {gdprJobs.length === 0 ? (
          <EmptyState icon={Shield} label={t('backup.gdpr.empty')} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-800">
            {gdprJobs.map(job => (
              <GdprJobRow key={job.id} job={job} dateFmt={dateFmt} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* ── Dialogs ─────────────────────────────────────────────────── */}
      {newBackupOpen && (
        <NewBackupDialog
          scopes={scopes}
          onClose={() => setNewBackupOpen(false)}
          onCreated={loadAll}
          t={t}
        />
      )}
      {restoreTarget && (
        <RestoreDialog
          job={restoreTarget}
          scopes={scopes}
          onClose={() => setRestoreTarget(null)}
          onCreated={loadAll}
          t={t}
        />
      )}
      {deleteTarget && (
        <DeleteBackupDialog
          job={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={loadAll}
          t={t}
        />
      )}
      {scheduleOpen && (
        <ScheduleDialog
          schedule={schedule}
          scopes={scopes}
          onClose={() => setScheduleOpen(false)}
          onSaved={loadAll}
          t={t}
        />
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ActiveBackupBanner({ jobs, t }: { jobs: BackupJob[]; t: (k: string) => string }) {
  const active = jobs.find(j => ['CAPTURING','UPLOADING','SEALING'].includes(j.status));
  if (!active) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100">
      <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
      <span>
        <strong>{t(`backup.phase.${active.phase ?? active.status}`)}</strong>
        {active.phaseProgress != null && ` — ${active.phaseProgress}%`}
      </span>
    </div>
  );
}

function BackupJobRow({
  job, scopes, dateFmt, expanded, onToggle, onRestore, onDelete, t,
}: {
  job: BackupJob; scopes: BackupScope[];
  dateFmt: Intl.DateTimeFormat;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onDelete: () => void;
  t: (k: string) => string;
}) {
  const scope = scopes.find(s => s.id === job.scopeId);
  const isRunning = ['CAPTURING','UPLOADING','SEALING','PENDING'].includes(job.status);
  const canRestore = job.status === 'COMPLETED' && !isRunning;
  const canDelete  = job.status === 'COMPLETED';
  const sizeLabel  = job.sizeBytes ? formatBytes(Number(job.sizeBytes)) : '—';

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-3 min-w-0 text-left flex-1"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
              {t(scope?.labelKey ?? `backup.scope.${job.scopeId}.label`)}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {dateFmt.format(new Date(job.createdAt))} · {sizeLabel}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <JobStatusBadge status={job.status} t={t} />
          {canRestore && (
            <button type="button" onClick={onRestore} aria-label={t('backup.restore')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800">
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          )}
          {canDelete && (
            <button type="button" onClick={onDelete} aria-label={t('backup.delete')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-red-500 hover:bg-red-50 dark:border-slate-700 dark:hover:bg-red-950/30">
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3">
            <span><strong>{t('backup.detail.tables')}</strong> {job.resolvedTables.length}</span>
            <span><strong>{t('backup.detail.rows')}</strong> {Object.values(job.rowCounts).reduce((a, b) => a + b, 0)}</span>
            <span><strong>{t('backup.detail.schema')}</strong> {job.schemaVersion ?? '—'}</span>
            {job.completedAt && (
              <span><strong>{t('backup.detail.completed')}</strong> {dateFmt.format(new Date(job.completedAt))}</span>
            )}
            <span><strong>{t('backup.detail.restores')}</strong> {job._count.restores}</span>
          </div>
          {job.resolvedTables.length > 0 && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-500 font-mono leading-relaxed">
              {job.resolvedTables.join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RestoreRow({ restore, dateFmt, t }: {
  restore: RestoreJob; dateFmt: Intl.DateTimeFormat; t: (k: string) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {t('backup.restore.from')} {restore.backupJob.scopeId}
          <span className="ml-2 text-xs font-normal text-slate-500">({restore.mode})</span>
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {dateFmt.format(new Date(restore.createdAt))}
          {restore.completedAt && ` · ${t('backup.restore.tables')}: ${restore.restoredTables.length}`}
        </p>
      </div>
      <JobStatusBadge status={restore.status} t={t} />
    </div>
  );
}

function ScheduleSummary({ schedule, dateFmt, scopes, t }: {
  schedule: BackupSchedule | null; dateFmt: Intl.DateTimeFormat;
  scopes: BackupScope[]; t: (k: string) => string;
}) {
  if (!schedule || !schedule.enabled) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-5 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('backup.schedule.disabled')}
      </div>
    );
  }
  const scope = scopes.find(s => s.id === schedule.scopeId);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
        <span><strong className="text-xs text-slate-500">{t('backup.schedule.freq')}</strong><br />{schedule.frequency}</span>
        <span><strong className="text-xs text-slate-500">{t('backup.schedule.scope')}</strong><br />{t(scope?.labelKey ?? schedule.scopeId)}</span>
        <span><strong className="text-xs text-slate-500">{t('backup.schedule.retain')}</strong><br />{schedule.retainCount}</span>
        {schedule.nextRunAt && (
          <span><strong className="text-xs text-slate-500">{t('backup.schedule.next')}</strong><br />{dateFmt.format(new Date(schedule.nextRunAt))}</span>
        )}
      </div>
    </div>
  );
}

function GdprJobRow({ job, dateFmt, t }: {
  job: GdprJob; dateFmt: Intl.DateTimeFormat; t: (k: string) => string;
}) {
  const isExpired = job.expiresAt && new Date(job.expiresAt) < new Date();
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {dateFmt.format(new Date(job.createdAt))}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {job.sizeBytes ? formatBytes(Number(job.sizeBytes)) : ''}
          {job.completedAt && ` · ${t('backup.gdpr.generated')} ${dateFmt.format(new Date(job.completedAt))}`}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <JobStatusBadge status={job.status} t={t} />
        {job.status === 'COMPLETED' && job.downloadUrl && !isExpired && (
          <a
            href={job.downloadUrl}
            download
            aria-label={t('backup.gdpr.download')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-teal-600 hover:bg-teal-50 dark:border-slate-700 dark:hover:bg-teal-950/30"
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        )}
        {isExpired && (
          <span className="text-xs text-slate-400">{t('backup.gdpr.expired')}</span>
        )}
      </div>
    </div>
  );
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

function NewBackupDialog({ scopes, onClose, onCreated, t }: {
  scopes: BackupScope[]; onClose: () => void;
  onCreated: () => void; t: (k: string) => string;
}) {
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? 'full');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await apiFetch('/api/backup/jobs', { method: 'POST', body: { scopeId } });
      onCreated(); onClose();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()} title={t('backup.new.title')}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">
            {t('backup.new.scope')}
          </label>
          <div className="space-y-2">
            {scopes.map(s => (
              <label key={s.id} className={cn(
                'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                scopeId === s.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                  : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300',
              )}>
                <input type="radio" name="scope" value={s.id}
                  checked={scopeId === s.id} onChange={() => setScopeId(s.id)} className="sr-only" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{t(s.labelKey)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(s.descKey)}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {s.tableCount > 0 ? `${s.tableCount} tables` : t('backup.scope.allTables')}
                    {s.minio ? ` · ${t('backup.scope.includesFiles')}` : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {err && <ErrorBanner msg={err} />}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} leftIcon={<HardDrive className="h-4 w-4" aria-hidden />}>
            {t('backup.new.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RestoreDialog({ job, scopes, onClose, onCreated, t }: {
  job: BackupJob; scopes: BackupScope[]; onClose: () => void;
  onCreated: () => void; t: (k: string) => string;
}) {
  const [mode, setMode] = useState<'ADDITIVE' | 'REPLACE'>('ADDITIVE');
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);
  const scope = scopes.find(s => s.id === job.scopeId);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await apiFetch('/api/backup/restores', {
        method: 'POST', body: { jobId: job.id, mode },
      });
      onCreated(); onClose();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()} title={t('backup.restore.title')}>
      <form onSubmit={submit} className="space-y-4">
        {/* Manifest preview */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
            {t('backup.restore.preview')}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-700 dark:text-slate-300">
            <span><strong>{t('backup.restore.scope')}</strong> {t(scope?.labelKey ?? job.scopeId)}</span>
            <span><strong>{t('backup.restore.tables')}</strong> {job.resolvedTables.length}</span>
            <span><strong>{t('backup.restore.rows')}</strong> {Object.values(job.rowCounts).reduce((a, b) => a + b, 0)}</span>
            <span><strong>{t('backup.restore.schema')}</strong> {job.schemaVersion ?? '—'}</span>
          </div>
        </div>

        {/* Mode */}
        <div>
          <p className="text-sm font-medium mb-2 text-slate-700 dark:text-slate-300">{t('backup.restore.modeLabel')}</p>
          {(['ADDITIVE', 'REPLACE'] as const).map(m => (
            <label key={m} className={cn(
              'flex items-start gap-3 rounded-lg border p-3 cursor-pointer mb-2 transition-colors',
              mode === m ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300',
            )}>
              <input type="radio" name="mode" value={m} checked={mode === m}
                onChange={() => setMode(m)} className="mt-0.5 accent-indigo-600" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {t(`backup.restore.mode.${m}`)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {t(`backup.restore.mode.${m}.desc`)}
                </p>
              </div>
            </label>
          ))}
        </div>

        {mode === 'REPLACE' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t('backup.restore.replaceWarning')}</span>
          </div>
        )}

        {err && <ErrorBanner msg={err} />}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} leftIcon={<RotateCcw className="h-4 w-4" aria-hidden />}>
            {t('backup.restore.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteBackupDialog({ job, onClose, onDeleted, t }: {
  job: BackupJob; onClose: () => void; onDeleted: () => void; t: (k: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    await apiFetch(`/api/backup/jobs/${job.id}`, { method: 'DELETE' }).catch(() => {});
    onDeleted(); onClose();
  }
  return (
    <Dialog open onOpenChange={o => !o && onClose()} title={t('backup.delete.title')}>
      <p className="text-sm text-slate-700 dark:text-slate-300 mb-6">{t('backup.delete.body')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={busy} onClick={confirm} className="bg-red-600 hover:bg-red-500 text-white">
          {t('backup.delete.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}

function ScheduleDialog({ schedule, scopes, onClose, onSaved, t }: {
  schedule: BackupSchedule | null; scopes: BackupScope[];
  onClose: () => void; onSaved: () => void; t: (k: string) => string;
}) {
  const [form, setForm] = useState<BackupSchedule>({
    enabled:     schedule?.enabled ?? false,
    frequency:   schedule?.frequency ?? 'WEEKLY',
    scopeId:     schedule?.scopeId ?? 'full',
    hourUtc:     schedule?.hourUtc ?? 2,
    dayOfWeek:   schedule?.dayOfWeek ?? 1,
    dayOfMonth:  schedule?.dayOfMonth ?? 1,
    retainCount: schedule?.retainCount ?? 7,
    lastRunAt:   null,
    nextRunAt:   null,
  });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await apiFetch('/api/backup/schedule', { method: 'PUT', body: form });
      onSaved(); onClose();
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); }
    finally { setBusy(false); }
  }

  const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <Dialog open onOpenChange={o => !o && onClose()} title={t('backup.schedule.title')}>
      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={form.enabled}
            onChange={e => setForm({ ...form, enabled: e.target.checked })} className="accent-indigo-600" />
          {t('backup.schedule.enable')}
        </label>

        {form.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">{t('backup.schedule.freq')}</label>
                <select className={inputCls} value={form.frequency}
                  onChange={e => setForm({ ...form, frequency: e.target.value })}>
                  {['DAILY','WEEKLY','MONTHLY'].map(f => (
                    <option key={f} value={f}>{t(`backup.schedule.freq.${f}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('backup.schedule.scope')}</label>
                <select className={inputCls} value={form.scopeId}
                  onChange={e => setForm({ ...form, scopeId: e.target.value })}>
                  {scopes.map(s => (
                    <option key={s.id} value={s.id}>{t(s.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('backup.schedule.hour')}</label>
                <input type="number" min="0" max="23" className={inputCls}
                  value={form.hourUtc}
                  onChange={e => setForm({ ...form, hourUtc: +e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">{t('backup.schedule.retain')}</label>
                <input type="number" min="1" max="365" className={inputCls}
                  value={form.retainCount}
                  onChange={e => setForm({ ...form, retainCount: +e.target.value })} />
              </div>
            </div>
          </>
        )}

        {err && <ErrorBanner msg={err} />}

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy}>{t('common.save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function GdprTriggerButton({ onCreated, t }: { onCreated: () => void; t: (k: string) => string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function trigger() {
    setBusy(true);
    try {
      await apiFetch('/api/backup/gdpr', { method: 'POST' });
      setDone(true); onCreated();
    } catch { /* error shown in list */ }
    finally { setBusy(false); }
  }
  if (done) return (
    <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> {t('backup.gdpr.requested')}
    </span>
  );
  return (
    <Button onClick={trigger} loading={busy}
      leftIcon={<Shield className="h-4 w-4" aria-hidden />}
      variant="outline" size="sm">
      {t('backup.gdpr.trigger')}
    </Button>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function JobStatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const map: Record<string, string> = {
    PENDING:   'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    CAPTURING: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    UPLOADING: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    SEALING:   'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
    FAILED:    'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200',
    DELETED:   'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
    RUNNING:   'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    GENERATING:'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200',
    ROLLED_BACK:'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200',
  };
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
      map[status] ?? map.PENDING,
    )}>
      {t(`backup.status.${status}`) || status}
    </span>
  );
}

function EmptyState({ icon: Icon, label }: { icon: typeof HardDrive; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
      <Icon className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
      <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{msg}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} Go`;
}
