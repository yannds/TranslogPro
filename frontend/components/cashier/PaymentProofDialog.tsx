/**
 * PaymentProofDialog — Saisie de la preuve paiement hors-POS par le caissier.
 *
 * Cas d'usage : le client paie MoMo / Airtel / Wave / carte / virement / voucher
 * sur SON téléphone ou son moyen à lui. Il montre/dicte un code de confirmation
 * (SMS MoMo, n° autorisation carte, référence virement…). Le caissier entre
 * ce code ici avant de confirmer la vente. L'audit caisse stocke alors la
 * preuve côté Transaction.proofCode + Transaction.proofType.
 *
 * Complémentaire à CashPadDialog (espèces) : ensemble couvrent tous les modes.
 *
 * i18n : clés `paymentProof.*` (fr + en).
 * WCAG : role=dialog via Dialog, focus auto, Enter soumet.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, Button, inputClass } from '../ui';
import { useI18n } from '../../lib/i18n/useI18n';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';

export type ProofType =
  | 'MOMO_CODE'
  | 'CARD_AUTH'
  | 'BANK_REF'
  | 'VOUCHER_CODE'
  | 'QR_PAYLOAD'
  | 'OTHER';

export interface PaymentProofDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Méthode de paiement courante (non-CASH). Pilote le type de preuve suggéré. */
  paymentMethod: 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'VOUCHER' | 'MIXED';
  /** Montant à encaisser (affichage récap). */
  amountDue: number;
  /** Callback sur validation — reçoit le code + son type. */
  onConfirm: (proof: { proofCode: string; proofType: ProofType }) => void;
  submitting?: boolean;
}

function defaultProofTypeFor(method: PaymentProofDialogProps['paymentMethod']): ProofType {
  switch (method) {
    case 'MOBILE_MONEY':  return 'MOMO_CODE';
    case 'CARD':          return 'CARD_AUTH';
    case 'BANK_TRANSFER': return 'BANK_REF';
    case 'VOUCHER':       return 'VOUCHER_CODE';
    default:              return 'OTHER';
  }
}

export function PaymentProofDialog({
  open,
  onOpenChange,
  paymentMethod,
  amountDue,
  onConfirm,
  submitting = false,
}: PaymentProofDialogProps) {
  const { t } = useI18n();
  const formatCurrency = useCurrencyFormatter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [proofCode, setProofCode] = useState('');
  const [proofType, setProofType] = useState<ProofType>(defaultProofTypeFor(paymentMethod));

  useEffect(() => {
    if (open) {
      setProofCode('');
      setProofType(defaultProofTypeFor(paymentMethod));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, paymentMethod]);

  const trimmed = proofCode.trim();
  // Validation minimale : ≥ 4 caractères (SMS MoMo courts existent : 4-8 chars).
  // La vérif réelle contre le provider se fait côté backend (Sprint 5 polling).
  const invalid = trimmed.length < 4;
  const canConfirm = !invalid && !submitting;

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canConfirm) {
      e.preventDefault();
      onConfirm({ proofCode: trimmed, proofType });
    }
  }

  const methodLabel = useMemo(() => {
    switch (paymentMethod) {
      case 'MOBILE_MONEY':  return t('paymentProof.methodMomo');
      case 'CARD':          return t('paymentProof.methodCard');
      case 'BANK_TRANSFER': return t('paymentProof.methodBank');
      case 'VOUCHER':       return t('paymentProof.methodVoucher');
      case 'MIXED':         return t('paymentProof.methodMixed');
    }
  }, [paymentMethod, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('paymentProof.title')}
      description={t('paymentProof.description', { method: methodLabel })}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('paymentProof.cancel')}
          </Button>
          <Button
            onClick={() => onConfirm({ proofCode: trimmed, proofType })}
            disabled={!canConfirm}
            loading={submitting}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            {t('paymentProof.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Récap montant + méthode */}
        <div
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3"
        >
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('paymentProof.recap')}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="text-sm text-slate-700 dark:text-slate-300 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              {methodLabel}
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-slate-50">
              {formatCurrency(amountDue)}
            </div>
          </div>
        </div>

        {/* Type de preuve */}
        <div>
          <label
            htmlFor="proof-type"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {t('paymentProof.typeLabel')}
          </label>
          <select
            id="proof-type"
            className={inputClass}
            value={proofType}
            onChange={(e) => setProofType(e.target.value as ProofType)}
            disabled={submitting}
          >
            <option value="MOMO_CODE">{t('paymentProof.type.momo')}</option>
            <option value="CARD_AUTH">{t('paymentProof.type.card')}</option>
            <option value="BANK_REF">{t('paymentProof.type.bank')}</option>
            <option value="VOUCHER_CODE">{t('paymentProof.type.voucher')}</option>
            <option value="QR_PAYLOAD">{t('paymentProof.type.qr')}</option>
            <option value="OTHER">{t('paymentProof.type.other')}</option>
          </select>
        </div>

        {/* Code / référence */}
        <div>
          <label
            htmlFor="proof-code"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {t('paymentProof.codeLabel')}
          </label>
          <input
            id="proof-code"
            ref={inputRef}
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className={inputClass}
            placeholder={t('paymentProof.codePlaceholder')}
            value={proofCode}
            onChange={(e) => setProofCode(e.target.value)}
            onKeyDown={handleKey}
            disabled={submitting}
            aria-invalid={invalid && trimmed.length > 0}
            aria-describedby="proof-hint"
          />
          <p id="proof-hint" className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('paymentProof.codeHint')}
          </p>
          {invalid && trimmed.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t('paymentProof.tooShort')}</span>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
