/**
 * SignatureDialog — capture une signature avec 3 modes, produit un SVG unique.
 *
 * Modes (onglets) :
 *   1. DRAW    — SignaturePad tactile/souris (défaut)
 *   2. UPLOAD  — import d'une image signature depuis disque (JPG/PNG, ≤ 250 KB
 *                après conversion → embed en base64 dans un <svg><image/></svg>)
 *   3. ATTEST  — checkbox d'attestation + nom + timestamp, sérialisé en SVG
 *                texte. Fallback pour environnements sans pad (écrans non
 *                tactiles, accessibilité, validation administrative).
 *
 * Tous les modes produisent un `signatureSvg: string` passé à `onConfirm()`.
 * Le backend ne distingue pas les modes — le SVG sert de chain-of-custody
 * visible à l'impression PDF, quelle que soit la source.
 *
 * Signature vide autorisée (signatureSvg = null) — le serveur accepte, mais
 * l'UX pousse un warning pour éviter l'oubli.
 */

import { useRef, useState, useEffect } from 'react';
import { FileSignature, Loader2, Upload, CheckSquare, Pencil, Image as ImageIcon } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useAuth } from '../../lib/auth/auth.context';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { cn } from '../../lib/utils';

export interface SignatureDialogProps {
  open:         boolean;
  title:        string;
  description?: string;
  /** Callback async — reçoit le SVG (string) ou null si signature vide. */
  onConfirm:    (signatureSvg: string | null) => Promise<void>;
  onClose:      () => void;
}

type Mode = 'DRAW' | 'UPLOAD' | 'ATTEST';

// 250 KB de payload SVG max — marge / sécurité vs limite backend 256 KB.
const MAX_SVG_BYTES = 250 * 1024;

export function SignatureDialog({
  open, title, description, onConfirm, onClose,
}: SignatureDialogProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const padRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy]       = useState(false);
  const [mode, setMode]       = useState<Mode>('DRAW');
  const [localErr, setLocalErr] = useState<string | null>(null);

  // ─── Mode UPLOAD ───────────────────────────────────────────────────────────
  const [uploadedSvg, setUploadedSvg]       = useState<string | null>(null);
  const [uploadedName, setUploadedName]     = useState<string | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);

  // ─── Mode ATTEST ───────────────────────────────────────────────────────────
  const [attested, setAttested] = useState(false);

  // Reset quand le dialog se ferme/rouvre — évite de garder une signature
  // précédente en mémoire si l'utilisateur annule et recommence.
  useEffect(() => {
    if (!open) {
      setMode('DRAW');
      setUploadedSvg(null);
      setUploadedName(null);
      setUploadedPreview(null);
      setAttested(false);
      setLocalErr(null);
      padRef.current?.clear();
    }
  }, [open]);

  // ─── Handlers UPLOAD ───────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setLocalErr(null);
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setLocalErr(t('signatureDialog.uploadErrType'));
      return;
    }
    if (file.size > 500 * 1024) {
      setLocalErr(t('signatureDialog.uploadErrSize'));
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    // Embed dans un SVG <image> — préserve le ratio, dimensions 400x200
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200">` +
      `<image href="${dataUrl}" width="400" height="200" preserveAspectRatio="xMidYMid meet"/>` +
      `</svg>`;
    if (svg.length > MAX_SVG_BYTES) {
      setLocalErr(t('signatureDialog.uploadErrTooLarge'));
      return;
    }
    setUploadedSvg(svg);
    setUploadedName(file.name);
    setUploadedPreview(dataUrl);
  }

  // ─── Handlers ATTEST ───────────────────────────────────────────────────────
  function attestSvg(): string {
    const name  = user?.name  ?? user?.email ?? t('signatureDialog.anonymous');
    const now   = new Date();
    const stamp = now.toLocaleString('fr-FR');
    // Encode les caractères spéciaux XML pour éviter un SVG cassé
    const safe = (s: string) => s.replace(/[<>&"']/g, c =>
      ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', '\'':'&#39;' } as Record<string,string>)[c]!);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180" width="600" height="180">` +
      `<rect width="600" height="180" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>` +
      `<text x="30" y="50" font-family="sans-serif" font-size="16" font-weight="bold" fill="#0f172a">ATTESTATION</text>` +
      `<text x="30" y="85" font-family="sans-serif" font-size="14" fill="#0f172a">${safe(t('signatureDialog.attestLine'))}</text>` +
      `<text x="30" y="115" font-family="sans-serif" font-size="14" fill="#0f172a">${t('signatureDialog.attestBy')} : ${safe(name)}</text>` +
      `<text x="30" y="145" font-family="sans-serif" font-size="14" fill="#0f172a">${t('signatureDialog.attestAt')} : ${safe(stamp)}</text>` +
      `</svg>`;
  }

  // ─── Confirmation ──────────────────────────────────────────────────────────
  async function handleConfirm() {
    setLocalErr(null);
    let svg: string | null = null;
    if (mode === 'DRAW') {
      svg = padRef.current?.getSvg() ?? null;
    } else if (mode === 'UPLOAD') {
      svg = uploadedSvg;
    } else if (mode === 'ATTEST') {
      if (!attested) {
        setLocalErr(t('signatureDialog.attestRequired'));
        return;
      }
      svg = attestSvg();
    }
    setBusy(true);
    try {
      await onConfirm(svg);
    } finally {
      setBusy(false);
    }
  }

  const canConfirm =
    (mode === 'DRAW')   // pad autorisé vide → signatureSvg=null côté POST
    || (mode === 'UPLOAD' && !!uploadedSvg)
    || (mode === 'ATTEST' && attested);

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o && !busy) onClose(); }}
      title={title}
      description={description}
      size="lg"
    >
      <div className="p-6 space-y-4">
        {/* ── Tabs / mode switcher ─────────────────────────────────────── */}
        <div role="tablist" aria-label={t('signatureDialog.modeLabel')} className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          <ModeTab mode="DRAW"   icon={<Pencil className="w-4 h-4" aria-hidden />}       label={t('signatureDialog.modeDraw')}   active={mode} onSelect={setMode} disabled={busy} />
          <ModeTab mode="UPLOAD" icon={<Upload className="w-4 h-4" aria-hidden />}       label={t('signatureDialog.modeUpload')} active={mode} onSelect={setMode} disabled={busy} />
          <ModeTab mode="ATTEST" icon={<CheckSquare className="w-4 h-4" aria-hidden />}  label={t('signatureDialog.modeAttest')} active={mode} onSelect={setMode} disabled={busy} />
        </div>

        {/* ── Panel DRAW ───────────────────────────────────────────────── */}
        {mode === 'DRAW' && (
          <div>
            <SignaturePad ref={padRef} disabled={busy} />
            <p className="text-xs t-text-3 mt-2">{t('signatureDialog.optionalHint')}</p>
          </div>
        )}

        {/* ── Panel UPLOAD ─────────────────────────────────────────────── */}
        {mode === 'UPLOAD' && (
          <div className="space-y-3">
            <label className={cn(
              'flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
              'border-slate-300 dark:border-slate-600 hover:border-[var(--color-primary)]',
              'bg-slate-50 dark:bg-slate-900/50',
              busy && 'opacity-50 cursor-not-allowed',
            )}>
              <ImageIcon className="w-8 h-8 text-slate-400" aria-hidden />
              <p className="text-sm font-medium">{t('signatureDialog.uploadPrompt')}</p>
              <p className="text-xs t-text-3">{t('signatureDialog.uploadHint')}</p>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = ''; // reset pour permettre re-upload du même fichier
                }}
              />
            </label>
            {uploadedPreview && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-50 flex items-center gap-3">
                <img src={uploadedPreview} alt="" className="h-20 w-auto object-contain" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold t-text truncate">{uploadedName}</p>
                  <p className="text-[11px] t-text-3">{t('signatureDialog.uploadReady')}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Panel ATTEST ─────────────────────────────────────────────── */}
        {mode === 'ATTEST' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 bg-slate-50 dark:bg-slate-900/50">
              <p className="text-sm t-text">{t('signatureDialog.attestLine')}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
                <dt className="t-text-3">{t('signatureDialog.attestBy')}</dt>
                <dd className="font-medium">{user?.name ?? user?.email ?? '—'}</dd>
                <dt className="t-text-3">{t('signatureDialog.attestAt')}</dt>
                <dd className="font-medium">
                  <time>{new Date().toLocaleString('fr-FR')}</time>
                </dd>
              </dl>
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={attested}
                onChange={e => setAttested(e.target.checked)}
                disabled={busy}
                className="mt-0.5 h-4 w-4"
              />
              <span>{t('signatureDialog.attestCheck')}</span>
            </label>
          </div>
        )}

        {localErr && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">{localErr}</p>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={busy || !canConfirm}
            leftIcon={busy
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <FileSignature className="w-4 h-4" aria-hidden />}
          >
            {busy ? t('common.saving') : t('signatureDialog.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ModeTab({
  mode, icon, label, active, onSelect, disabled,
}: {
  mode: Mode;
  icon: React.ReactNode;
  label: string;
  active: Mode;
  onSelect: (m: Mode) => void;
  disabled?: boolean;
}) {
  const isActive = mode === active;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      disabled={disabled}
      onClick={() => onSelect(mode)}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-1',
        isActive
          ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
