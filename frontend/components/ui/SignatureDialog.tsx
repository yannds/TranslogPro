/**
 * SignatureDialog — modale qui capture une signature tactile avant de valider.
 *
 * Utilisée par les pages Manifest (chauffeur + agent quai) : l'utilisateur
 * clique « Signer », la modale s'ouvre avec le SignaturePad. À la validation,
 * on récupère le SVG et on passe au callback `onConfirm` (qui se charge du
 * POST /manifests/:id/sign).
 *
 * Signature vide autorisée (l'user peut cliquer "Signer" sans dessiner,
 * ex. PDF non-tactile) — le serveur accepte signatureSvg null/undefined.
 * Un warning visuel est affiché dans ce cas pour éviter l'oubli.
 */

import { useRef, useState } from 'react';
import { FileSignature, Loader2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';

export interface SignatureDialogProps {
  open:      boolean;
  title:     string;
  description?: string;
  /** Callback async — reçoit le SVG (string) ou null si signature vide. */
  onConfirm: (signatureSvg: string | null) => Promise<void>;
  onClose:   () => void;
}

export function SignatureDialog({
  open, title, description, onConfirm, onClose,
}: SignatureDialogProps) {
  const { t } = useI18n();
  const padRef = useRef<SignaturePadHandle>(null);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    const svg = padRef.current?.getSvg() ?? null;
    setBusy(true);
    try {
      await onConfirm(svg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o && !busy) onClose(); }}
      title={title}
      description={description}
      size="lg"
    >
      <div className="p-6 space-y-4">
        <SignaturePad ref={padRef} disabled={busy} />
        <p className="text-xs t-text-3">
          {t('signatureDialog.optionalHint')}
        </p>
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={busy}
            leftIcon={busy
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <FileSignature className="w-4 h-4" aria-hidden />}>
            {busy ? t('common.saving') : t('signatureDialog.confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
