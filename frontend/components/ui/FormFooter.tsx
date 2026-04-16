/**
 * FormFooter — pied de formulaire standardisé : bouton Annuler + bouton Soumettre.
 *
 * Gère les états `busy` (loading + disabled) et bascule le libellé du bouton
 * de soumission pendant l'action (`submitLabel` ↔ `pendingLabel`).
 */

import { X, Check } from 'lucide-react';
import { Button } from './Button';
import { useI18n } from '../../lib/i18n/useI18n';

export interface FormFooterProps {
  onCancel: () => void;
  busy: boolean;
  /** Libellé par défaut du bouton de soumission (ex. "Créer"). */
  submitLabel: string;
  /** Libellé affiché pendant la soumission (ex. "Création…"). */
  pendingLabel: string;
  cancelLabel?: string;
}

export function FormFooter({
  onCancel,
  busy,
  submitLabel,
  pendingLabel,
  cancelLabel,
}: FormFooterProps) {
  const { t } = useI18n();
  const resolvedCancel = cancelLabel ?? t('common.cancel');
  return (
    <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        <X className="w-4 h-4 mr-1.5" aria-hidden />{resolvedCancel}
      </Button>
      <Button type="submit" disabled={busy} loading={busy}>
        <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}
