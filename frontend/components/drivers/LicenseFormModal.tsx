/**
 * LicenseFormModal — Modale partagée pour la gestion des permis de conduire.
 *
 * Point d'entrée unique ("Single Entry Point") : toute création ou modification
 * de permis passe par cette modale. Le backend synchronise automatiquement
 * DriverLicense, StaffAssignment.licenseData et Attachment(LICENSE).
 *
 * Le formulaire inclut un upload optionnel du scan (photo/PDF) qui est envoyé
 * en multipart avec les données structurées.
 *
 * Utilisé par :
 *   - PageDriverProfile (onglet Permis)
 *   - PagePersonnel (EditStaffForm, à la place de l'upload LICENSE)
 *
 * WCAG 2.1 AA : labels explicites, focus trap (Dialog), aria-invalid.
 * Dark mode : Tailwind dark: variants.
 * Responsive : grid 1→2 cols.
 * i18n : toutes les chaînes via t().
 */

import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Upload, X, FileText, Image as ImgIcon, Eye } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useI18n }    from '../../lib/i18n/useI18n';
import { Dialog }     from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import { cn }         from '../../lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LicenseValues {
  staffId:      string;
  category:     string;
  licenseNo:    string;
  issuedAt:     string;
  expiresAt:    string;
  issuingState: string;
}

export interface DriverOption {
  id:   string;
  label: string;
}

export interface LicenseFormModalProps {
  open:        boolean;
  onClose:     () => void;
  /** Called with structured values + optional file. */
  onSubmit:    (v: LicenseValues, file?: File) => void | Promise<void>;
  busy:        boolean;
  error:       string | null;
  drivers:     DriverOption[];
  /** Pre-fill for editing or when staffId is known (from PagePersonnel). */
  initial?:    Partial<LicenseValues>;
  /** Lock the driver selector (when opened from a specific staff context). */
  lockStaff?:  boolean;
  /** Dialog title override. */
  title?:      string;
  /** Existing scan file key (shown during edit so user knows a file is already attached). */
  existingFileKey?: string | null;
  /** License ID + tenantId needed to fetch scan download URL. */
  licenseId?: string;
  tenantId?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';
const MAX_MB = 15;

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return <ImgIcon className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden />;
  return <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" aria-hidden />;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function LicenseFormModal({
  open, onClose, onSubmit, busy, error, drivers, initial, lockStaff, title, existingFileKey, licenseId, tenantId,
}: LicenseFormModalProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);

  const buildInitial = (): LicenseValues => ({
    staffId:      initial?.staffId      ?? drivers[0]?.id ?? '',
    category:     initial?.category     ?? 'D',
    licenseNo:    initial?.licenseNo    ?? '',
    issuedAt:     initial?.issuedAt     ?? '',
    expiresAt:    initial?.expiresAt    ?? '',
    issuingState: initial?.issuingState ?? '',
  });

  const [f, setF] = useState<LicenseValues>(buildInitial);

  // Reset form when the modal opens or the edited item changes
  useEffect(() => {
    if (open) {
      setF(buildInitial());
      setFile(null);
      setFileErr(null);
    }
  }, [open, initial?.licenseNo, initial?.staffId]);

  // Sync staffId when drivers load asynchronously and current staffId is empty
  useEffect(() => {
    if (!f.staffId && drivers.length > 0) {
      setF(p => ({ ...p, staffId: drivers[0].id }));
    }
  }, [drivers]);

  const [file, setFile]       = useState<File | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const handleFile = (picked: File | undefined | null) => {
    if (!picked) return;
    setFileErr(null);
    if (picked.size > MAX_MB * 1024 * 1024) {
      setFileErr(`${t('driverLicense.fileTooLarge')} (max ${MAX_MB} Mo)`);
      return;
    }
    setFile(picked);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(f, file ?? undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={title ?? t('driverLicense.modalTitle')}
      size="xl"
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <ErrorAlert error={error} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Driver selector */}
          <div className="sm:col-span-2 space-y-1.5">
            <label htmlFor="licm-staff" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.driver')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <select
              id="licm-staff"
              required
              value={f.staffId}
              onChange={e => setF(p => ({ ...p, staffId: e.target.value }))}
              className={inputClass}
              disabled={busy || lockStaff || drivers.length === 0}
              aria-disabled={lockStaff}
            >
              {drivers.length === 0 && <option value="">{t('driverLicense.noDriver')}</option>}
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label htmlFor="licm-cat" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.category')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="licm-cat"
              type="text"
              required
              value={f.category}
              onChange={e => setF(p => ({ ...p, category: e.target.value.toUpperCase() }))}
              className={inputClass}
              disabled={busy}
              placeholder="D"
              maxLength={8}
            />
          </div>

          {/* License number */}
          <div className="space-y-1.5">
            <label htmlFor="licm-no" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.licenseNo')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="licm-no"
              type="text"
              required
              value={f.licenseNo}
              onChange={e => setF(p => ({ ...p, licenseNo: e.target.value }))}
              className={cn(inputClass, 'font-mono')}
              disabled={busy}
            />
          </div>

          {/* Issued date */}
          <div className="space-y-1.5">
            <label htmlFor="licm-issued" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.issuedAt')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="licm-issued"
              type="date"
              required
              value={f.issuedAt}
              onChange={e => setF(p => ({ ...p, issuedAt: e.target.value }))}
              className={inputClass}
              disabled={busy}
            />
          </div>

          {/* Expiry date */}
          <div className="space-y-1.5">
            <label htmlFor="licm-expires" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.expiresAt')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <input
              id="licm-expires"
              type="date"
              required
              value={f.expiresAt}
              onChange={e => setF(p => ({ ...p, expiresAt: e.target.value }))}
              className={inputClass}
              disabled={busy}
            />
          </div>

          {/* Issuing state */}
          <div className="sm:col-span-2 space-y-1.5">
            <label htmlFor="licm-state" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.issuingState')}
            </label>
            <input
              id="licm-state"
              type="text"
              value={f.issuingState}
              onChange={e => setF(p => ({ ...p, issuingState: e.target.value }))}
              className={inputClass}
              disabled={busy}
              placeholder="CG"
            />
          </div>

          {/* ── File upload (scan du permis) ── */}
          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('driverLicense.scanLabel')}
            </label>

            {/* Existing scan indicator (edit mode) with view button */}
            {!file && existingFileKey && (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
                <FileText className="w-4 h-4 flex-shrink-0" aria-hidden />
                <span className="flex-1 truncate">{t('driverLicense.existingScan')}</span>
                {licenseId && tenantId && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await apiFetch(`/api/tenants/${tenantId}/driver-profile/licenses/${licenseId}/scan`) as { downloadUrl: string };
                        window.open(res.downloadUrl, '_blank', 'noopener');
                      } catch { /* silently fail */ }
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-800/40 hover:bg-green-200 dark:hover:bg-green-800/60 transition-colors"
                    aria-label={t('driverLicense.viewScan')}
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden />
                    {t('driverLicense.viewScan')}
                  </button>
                )}
              </div>
            )}

            {file ? (
              /* File selected — show preview strip */
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2.5">
                {fileIcon(file.type)}
                <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                  {file.name}
                </span>
                <span className="text-xs text-slate-400">{humanSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 transition-colors"
                  aria-label={t('common.remove')}
                  disabled={busy}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              /* Drop zone */
              <label
                htmlFor="licm-file"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border-2 border-dashed',
                  'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40',
                  'px-4 py-5 text-sm text-slate-600 dark:text-slate-400 cursor-pointer',
                  'hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300',
                  'focus-within:ring-2 focus-within:ring-teal-500/40 transition-colors',
                  busy && 'opacity-60 pointer-events-none',
                )}
              >
                <Upload className="w-4 h-4 flex-shrink-0" aria-hidden />
                <span>
                  {t('driverLicense.dropOrBrowse')}
                  <span className="ml-2 text-xs text-slate-400">(PDF/JPG/PNG, max {MAX_MB} Mo)</span>
                </span>
                <input
                  ref={fileRef}
                  id="licm-file"
                  type="file"
                  accept={ACCEPT}
                  onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
                  disabled={busy}
                  className="sr-only"
                />
              </label>
            )}

            {fileErr && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">{fileErr}</p>
            )}
          </div>
        </div>

        <FormFooter
          onCancel={onClose}
          busy={busy}
          submitLabel={t('common.save')}
          pendingLabel={t('common.saving')}
        />
      </form>
    </Dialog>
  );
}
