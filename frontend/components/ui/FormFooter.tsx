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
  /** ID du <form> cible — utile quand le footer est rendu hors du <form> (slot Dialog). */
  formId?: string;
  /** Handler optionnel câblé sur le clic du bouton de soumission. Utilisé quand
   * le footer est rendu hors d'un <form> (modale de confirmation par ex.). */
  onSubmit?: () => void | Promise<void>;
  /** Variante visuelle du bouton de soumission. `'danger'` et `'destructive'`
   * mappent sur la variante destructive du Button (rouge). */
  variant?: 'default' | 'primary' | 'danger' | 'destructive' | 'amber';
}

const VARIANT_TO_BUTTON: Record<NonNullable<FormFooterProps['variant']>,
  'default' | 'primary' | 'destructive' | 'amber'> = {
  default:     'default',
  primary:     'primary',
  danger:      'destructive',
  destructive: 'destructive',
  amber:       'amber',
};

export function FormFooter({
  onCancel,
  busy,
  submitLabel,
  pendingLabel,
  cancelLabel,
  formId,
  onSubmit,
  variant,
}: FormFooterProps) {
  const { t } = useI18n();
  const resolvedCancel = cancelLabel ?? t('common.cancel');
  const submitVariant = variant ? VARIANT_TO_BUTTON[variant] : 'default';
  const handleSubmitClick = onSubmit
    ? () => { void onSubmit(); }
    : undefined;
  return (
    <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
      <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
        <X className="w-4 h-4 mr-1.5" aria-hidden />{resolvedCancel}
      </Button>
      <Button
        type={onSubmit ? 'button' : 'submit'}
        form={formId}
        variant={submitVariant}
        disabled={busy}
        loading={busy}
        onClick={handleSubmitClick}
      >
        <Check className="w-4 h-4 mr-1.5" aria-hidden />{busy ? pendingLabel : submitLabel}
      </Button>
    </div>
  );
}
