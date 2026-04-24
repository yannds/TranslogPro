/**
 * UploadScanDialog — composant réutilisable pour uploader un fichier (scan PDF,
 * photo, justificatif) via le pattern presigned URL utilisé partout dans
 * TransLog Pro :
 *
 *   1. POST|GET <uploadUrlEndpoint> [ + body optionnel ]
 *      → réponse : { uploadUrl: string, fileKey: string }
 *   2. PUT uploadUrl avec le fichier en body
 *   3. Callback onUploaded({ fileKey, file }) pour que le parent finalise
 *      (ex : POST /confirm ou mise à jour optimiste).
 *
 * Consommateurs :
 *   - fleet-docs (documents/:id/upload-url)
 *   - driver-profile (licenses/:id/upload-url, trainings/:id/upload-url)
 *   - qhse (accidents/:id/photo-url, third-parties/:id/statement-url,
 *           follow-ups/:id/upload-url, dispute-expenses/:id/upload-url,
 *           executions/:executionId/steps/:stepId/photo-url)
 *   - garage (reports/:id/upload-url)
 *   - templates (:id/upload-url)
 *   - fleet (buses/:id/photos/upload-url)
 *
 * Contrat qualité UI/UX :
 *   - Dialog accessible (focus trap, aria, Escape)
 *   - Drag & drop + browse, preview fichier, validation taille/MIME
 *   - Progress bar upload, messages d'erreur clairs
 *   - i18n via `t('uploadScan.*')` (clé générique factorisée)
 *   - Dark + light, responsive
 */

import { useState, useCallback, type ChangeEvent, type DragEvent } from 'react';
import { Upload, FileText, Image as ImgIcon, X, Loader2, CheckCircle2 } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { apiFetch, ApiError } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';

export interface UploadScanResult {
  fileKey: string;
  file:    File;
}

export interface UploadScanDialogProps {
  /** Contrôle de visibilité. */
  open:    boolean;
  onClose: () => void;
  /** Endpoint backend qui retourne la presigned URL. Ex: `/api/tenants/X/fleet-docs/documents/Y/upload-url` */
  uploadUrlEndpoint: string;
  /** Méthode HTTP pour obtenir la presigned URL. POST par défaut. */
  uploadUrlMethod?: 'POST' | 'GET';
  /** Body optionnel envoyé au endpoint (ex: `{ ext: 'pdf' }` pour fleet bus photos). */
  uploadUrlBody?: Record<string, unknown>;
  /** Appelé après PUT réussi. Le parent peut persister `fileKey` via un POST confirm. */
  onUploaded: (result: UploadScanResult) => void | Promise<void>;
  /** Formats acceptés côté HTML <input>. Défaut : scans docs (PDF+images). */
  accept?: string;
  /** Taille max en Mo. Défaut : 15. */
  maxMB?: number;
  /** Titre du dialog. Défaut : `t('uploadScan.title')`. */
  title?: string;
  /** Description du dialog. Défaut : `t('uploadScan.description')`. */
  description?: string;
}

const DEFAULT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const DEFAULT_MAX_MB = 15;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImgIcon className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />;
  return <FileText className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden />;
}

export function UploadScanDialog({
  open,
  onClose,
  uploadUrlEndpoint,
  uploadUrlMethod = 'POST',
  uploadUrlBody,
  onUploaded,
  accept = DEFAULT_ACCEPT,
  maxMB = DEFAULT_MAX_MB,
  title,
  description,
}: UploadScanDialogProps) {
  const { t } = useI18n();
  const [file,     setFile]     = useState<File | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState<string | null>(null);
  const [done,     setDone]     = useState(false);

  const reset = useCallback(() => {
    setFile(null);
    setBusy(false);
    setProgress(0);
    setError(null);
    setDone(false);
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, reset, onClose]);

  const handleFileSelected = useCallback((f: File) => {
    setError(null);
    if (f.size > maxMB * 1024 * 1024) {
      setError(t('uploadScan.fileTooLarge').replace('{max}', String(maxMB)));
      return;
    }
    setFile(f);
  }, [maxMB, t]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) handleFileSelected(f);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFileSelected(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true); setError(null); setProgress(5);
    try {
      // 1. Obtenir presigned URL
      const presigned = await apiFetch<{ uploadUrl: string; fileKey?: string; key?: string }>(
        uploadUrlEndpoint,
        {
          method: uploadUrlMethod,
          body:   uploadUrlMethod === 'POST' ? (uploadUrlBody ?? {}) : undefined,
        },
      );
      setProgress(30);

      const fileKey = presigned.fileKey ?? presigned.key;
      if (!presigned.uploadUrl || !fileKey) {
        throw new Error(t('uploadScan.errorInvalidResponse'));
      }

      // 2. PUT vers MinIO/S3
      const put = await fetch(presigned.uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!put.ok) throw new Error(t('uploadScan.errorUploadFailed').replace('{status}', String(put.status)));
      setProgress(80);

      // 3. Callback parent (confirm/persist)
      await onUploaded({ fileKey, file });
      setProgress(100);
      setDone(true);

      // Fermeture auto après 800ms
      setTimeout(() => { handleClose(); }, 800);
    } catch (e) {
      const msg = e instanceof ApiError
        ? (typeof e.body === 'object' && e.body && 'message' in e.body
            ? String((e.body as { message: unknown }).message)
            : e.message)
        : (e as Error).message;
      setError(msg);
      setProgress(0);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) handleClose(); }}
      title={title ?? t('uploadScan.title')}
      description={description ?? t('uploadScan.description')}
      size="md"
    >
      <div className="space-y-4">
        <ErrorAlert error={error} />

        {/* Zone drop / sélection */}
        {!file ? (
          <label
            htmlFor="upload-scan-input"
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed',
              'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40',
              'px-4 py-10 text-sm text-slate-600 dark:text-slate-400 cursor-pointer',
              'hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300',
              'focus-within:ring-2 focus-within:ring-teal-500/40',
            )}
          >
            <Upload className="w-8 h-8 text-slate-400 dark:text-slate-500" aria-hidden />
            <span className="font-medium">{t('uploadScan.dropOrBrowse')}</span>
            <span className="text-xs text-slate-400">
              {t('uploadScan.sizeHint').replace('{max}', String(maxMB))}
            </span>
            <input
              id="upload-scan-input"
              type="file"
              accept={accept}
              onChange={onInputChange}
              className="sr-only"
              disabled={busy}
            />
          </label>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="flex items-center gap-3">
              <div className="shrink-0">{fileIcon(file.type)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{file.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{humanSize(file.size)}</p>
              </div>
              {!busy && !done && (
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label={t('uploadScan.removeFile')}
                  className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              )}
              {done && (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" aria-hidden />
              )}
            </div>
          </div>
        )}

        {/* Progress */}
        {progress > 0 && (
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('uploadScan.uploading')}
            className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800"
          >
            <div
              className={cn(
                'h-full transition-[width] duration-200',
                done ? 'bg-emerald-500' : 'bg-teal-500',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="ghost"
            onClick={handleClose}
            disabled={busy}
            aria-label={t('common.cancel')}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || busy || done}
            aria-label={t('uploadScan.upload')}
          >
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden />}
            {done
              ? t('uploadScan.uploaded')
              : busy
                ? t('uploadScan.uploading')
                : t('uploadScan.upload')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
