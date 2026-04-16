/**
 * DocumentAttachments — Bloc réutilisable pour uploader/lister/supprimer
 * les pièces jointes liées à une entité (CUSTOMER, STAFF, VEHICLE…).
 *
 * API backend :
 *   GET    /api/tenants/:tid/attachments?entityType=X&entityId=Y
 *   POST   /api/tenants/:tid/attachments   (multipart: file, entityType, entityId, kind)
 *   GET    /api/tenants/:tid/attachments/:id/download   (redirect presigned)
 *   DELETE /api/tenants/:tid/attachments/:id
 *
 * Light par défaut, dark compatible, ARIA (role=alert, aria-label, focus management).
 */

import { useCallback, useEffect, useState } from 'react';
import { Upload, Trash2, Download, FileText, Image as ImgIcon, Loader2, AlertTriangle, Eye, X, ExternalLink } from 'lucide-react';
import { useFetch }    from '../../lib/hooks/useFetch';
import { apiFetch, apiDelete, ApiError } from '../../lib/api';
import { Badge }       from '../ui/Badge';
import { useI18n } from '../../lib/i18n/useI18n';

export type AttachmentEntityType = 'CUSTOMER' | 'STAFF' | 'VEHICLE' | 'TRIP' | 'INCIDENT' | 'PARCEL';
export type AttachmentKind = 'CONTRACT' | 'ID_CARD' | 'LICENSE' | 'CERTIFICATE' | 'PHOTO' | 'OTHER';

export interface Attachment {
  id:         string;
  tenantId:   string;
  entityType: string;
  entityId:   string;
  kind:       string;
  fileName:   string;
  mimeType:   string;
  size:       number;
  storageKey: string;
  createdAt:  string;
}

// ─── i18n keys are in locales/fr.ts + en.ts under 'documents' namespace ─────

function kindLabels(t: (keyOrMap: string | Record<string, string | undefined>) => string): Record<AttachmentKind, string> {
  return {
    CONTRACT:    t('documents.kindContract'),
    ID_CARD:     t('documents.kindIdCard'),
    LICENSE:     t('documents.kindLicense'),
    CERTIFICATE: t('documents.kindCertificate'),
    PHOTO:       t('documents.kindPhoto'),
    OTHER:       t('documents.kindOther'),
  };
}

const KIND_OPTIONS: AttachmentKind[] = ['CONTRACT', 'ID_CARD', 'LICENSE', 'CERTIFICATE', 'PHOTO', 'OTHER'];

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx';
const MAX_MB = 15;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImgIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />;
  return <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden />;
}

export interface DocumentAttachmentsProps {
  tenantId:   string;
  entityType: AttachmentEntityType;
  entityId:   string;
  /** Restreint les kinds proposés à l'upload (par défaut tous). */
  allowedKinds?: AttachmentKind[];
  /** Masque l'uploader (lecture seule). */
  readOnly?: boolean;
  /** Notifie le parent quand l'aperçu s'ouvre/ferme (pour élargir la modale). */
  onPreviewChange?: (open: boolean) => void;
}

export function DocumentAttachments({
  tenantId, entityType, entityId, allowedKinds, readOnly = false, onPreviewChange,
}: DocumentAttachmentsProps) {
  const { t } = useI18n();
  const KIND_LABELS = kindLabels(t);
  const base = `/api/tenants/${tenantId}/attachments`;
  const url  = entityId ? `${base}?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}` : null;

  const { data, loading, error, refetch } = useFetch<Attachment[]>(url, [tenantId, entityType, entityId]);

  const [kind,     setKind]     = useState<AttachmentKind>((allowedKinds?.[0] ?? 'OTHER') as AttachmentKind);
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [preview,  setPreview]  = useState<Attachment | null>(null);

  useEffect(() => {
    onPreviewChange?.(preview !== null);
  }, [preview, onPreviewChange]);

  const kindChoices = allowedKinds ?? KIND_OPTIONS;

  const upload = useCallback(async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadErr(`${t('documents.fileTooLarge')} (max ${MAX_MB} Mo)`);
      return;
    }
    setBusy(true); setUploadErr(null); setProgress(10);
    try {
      const form = new FormData();
      form.append('file',       file);
      form.append('entityType', entityType);
      form.append('entityId',   entityId);
      form.append('kind',       kind);

      setProgress(40);
      await apiFetch(base, { method: 'POST', body: form });
      setProgress(100);
      refetch();
    } catch (e) {
      const msg = e instanceof ApiError ? (typeof e.body === 'object' && e.body && 'message' in e.body ? String((e.body as { message: unknown }).message) : e.message) : (e as Error).message;
      setUploadErr(msg);
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 600);
    }
  }, [base, entityType, entityId, kind, refetch]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void upload(file);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const handleDelete = async (att: Attachment) => {
    if (!confirm(`${t('documents.confirmDelete')} « ${att.fileName} » ?`)) return;
    try {
      await apiDelete(`${base}/${att.id}`);
      refetch();
    } catch (e) {
      setUploadErr((e as Error).message);
    }
  };

  const splitLayout = preview !== null;

  const leftCol = (
    <div className="space-y-3 min-w-0">
      {/* Uploader */}
      {!readOnly && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="att-kind">
              {t('documents.docType')}
            </label>
            <select
              id="att-kind"
              value={kind}
              onChange={e => setKind(e.target.value as AttachmentKind)}
              disabled={busy}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            >
              {kindChoices.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>

          <label
            htmlFor="att-file"
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            className={
              'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed ' +
              'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 ' +
              'px-4 py-6 text-sm text-slate-600 dark:text-slate-400 cursor-pointer ' +
              'hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 focus-within:ring-2 focus-within:ring-teal-500/40 ' +
              (busy ? 'opacity-60 pointer-events-none' : '')
            }
          >
            {busy
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <Upload className="w-4 h-4" aria-hidden />}
            <span>
              {busy ? t('documents.uploading') : t('documents.dropOrBrowse')}
              <span className="ml-2 text-xs text-slate-400">(PDF/JPG/PNG/DOCX/XLSX, max {MAX_MB} Mo)</span>
            </span>
            <input
              id="att-file"
              type="file"
              accept={ACCEPT}
              onChange={onFileChange}
              disabled={busy}
              className="sr-only"
            />
          </label>

          {progress > 0 && (
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800"
            >
              <div
                className="h-full bg-teal-500 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {uploadErr && (
            <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />{uploadErr}
            </div>
          )}
        </div>
      )}

      {/* Liste */}
      <div className="space-y-1.5" aria-busy={loading}>
        {error && (
          <div role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {loading && !data && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('documents.loading')}</p>
        )}

        {data && data.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">{t('documents.noAttachments')}</p>
        )}

        {data && data.map(att => {
          const isPreviewable = att.mimeType === 'application/pdf' || att.mimeType.startsWith('image/');
          const isActive = preview?.id === att.id;
          return (
            <div
              key={att.id}
              className={
                'flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ' +
                (isActive
                  ? 'border-teal-400 bg-teal-50/50 dark:border-teal-700 dark:bg-teal-900/20'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900')
              }
            >
              <button
                type="button"
                onClick={() => isPreviewable && setPreview(isActive ? null : att)}
                disabled={!isPreviewable}
                aria-label={isPreviewable ? `Prévisualiser ${att.fileName}` : att.fileName}
                aria-expanded={isActive}
                className={
                  'flex items-center gap-3 min-w-0 flex-1 text-left rounded focus:outline-none ' +
                  (isPreviewable
                    ? 'cursor-pointer hover:opacity-80 focus-visible:ring-2 focus-visible:ring-teal-500/40'
                    : 'cursor-default')
                }
              >
                <div className="shrink-0">{fileIcon(att.mimeType)}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {att.fileName}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <Badge variant="default">{KIND_LABELS[att.kind as AttachmentKind] ?? att.kind}</Badge>
                    <span className="tabular-nums">{humanSize(att.size)}</span>
                    <span>·</span>
                    <span>{new Date(att.createdAt).toLocaleDateString('fr-FR')}</span>
                    {isPreviewable && (
                      <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300">
                        <Eye className="w-3 h-3" aria-hidden />{isActive ? t('documents.clickToHide') : t('documents.clickToShow')}
                      </span>
                    )}
                  </div>
                </div>
              </button>
              <a
                href={`${base}/${att.id}/download`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Télécharger ${att.fileName}`}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-teal-700 dark:hover:text-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
              >
                <Download className="w-4 h-4" aria-hidden />
              </a>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void handleDelete(att)}
                  aria-label={`Supprimer ${att.fileName}`}
                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );

  return splitLayout ? (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
      {leftCol}
      <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
        {preview && (
          <InlinePreview
            attachment={preview}
            downloadUrl={`${base}/${preview.id}/download`}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </div>
  ) : leftCol;
}

// ─── Preview inline (PDF / image) ─────────────────────────────────────────────

function InlinePreview({
  attachment, downloadUrl, onClose,
}: {
  attachment:  Attachment;
  downloadUrl: string;
  onClose:     () => void;
}) {
  const { t } = useI18n();
  const isImage = attachment.mimeType.startsWith('image/');
  const isPdf   = attachment.mimeType === 'application/pdf';

  return (
    <div
      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden"
      role="region"
      aria-label={`Aperçu de ${attachment.fileName}`}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
            {attachment.fileName}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Ouvrir dans un nouvel onglet"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            <span className="hidden sm:inline">{t('documents.open')}</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'aperçu"
            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="bg-slate-100 dark:bg-slate-950 flex items-center justify-center max-h-[65vh] overflow-auto">
        {isImage && (
          <img
            src={downloadUrl}
            alt={attachment.fileName}
            className="max-h-[65vh] w-auto object-contain"
          />
        )}
        {isPdf && (
          <iframe
            src={downloadUrl}
            title={attachment.fileName}
            className="w-full h-[65vh] border-0 bg-white"
          />
        )}
        {!isImage && !isPdf && (
          <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
            {t('documents.previewUnavail')}
          </p>
        )}
      </div>
    </div>
  );
}
