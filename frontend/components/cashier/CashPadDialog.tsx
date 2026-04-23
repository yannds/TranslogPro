/**
 * CashPadDialog — Saisie du montant remis en espèces + calcul monnaie rendue.
 *
 * Flux :
 *   1. Le caissier tape "Encaisser".
 *   2. Modale s'ouvre : montant dû affiché, input `tendered` pré-rempli au dû.
 *   3. Change = tendered - dû, recalculé en live. Bloque si tendered < dû.
 *   4. Raccourcis billets (×2, +1000, +5000, +10000) pour saisir vite.
 *   5. Valider → onConfirm(tendered) → parent envoie au backend.
 *
 * i18n : clés sous `cashPad.*` (fr + en obligatoires).
 * WCAG : role="dialog" via Dialog, aria-live sur le résumé, focus auto sur input,
 *        Enter soumet, Escape annule.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Calculator, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, Button, inputClass } from '../ui';
import { useI18n } from '../../lib/i18n/useI18n';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';

export interface CashPadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Montant total dû par le client (TTC, après taxes + remises). */
  amountDue: number;
  /** Bouquets de raccourcis billets — défaut adapté XAF/XOF. */
  quickAmounts?: number[];
  /** Callback sur validation — reçoit le tendered final (≥ amountDue). */
  onConfirm: (tendered: number) => void;
  /** État de soumission en cours (affiche loader, bloque changes). */
  submitting?: boolean;
}

const DEFAULT_QUICK_XAF = [1_000, 2_000, 5_000, 10_000, 20_000];

export function CashPadDialog({
  open,
  onOpenChange,
  amountDue,
  quickAmounts = DEFAULT_QUICK_XAF,
  onConfirm,
  submitting = false,
}: CashPadDialogProps) {
  const { t } = useI18n();
  const formatCurrency = useCurrencyFormatter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [tendered, setTendered] = useState<string>('');

  // Réinit à l'ouverture : pré-remplit avec amountDue pour un paiement exact.
  useEffect(() => {
    if (open) {
      setTendered(String(Math.round(amountDue * 100) / 100));
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, amountDue]);

  const tenderedNum = useMemo(() => {
    const v = Number(tendered);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }, [tendered]);

  const change = useMemo(() => {
    return Math.max(0, Math.round((tenderedNum - amountDue) * 100) / 100);
  }, [tenderedNum, amountDue]);

  const insufficient = tenderedNum < amountDue - 0.005;
  const canConfirm = !insufficient && !submitting;

  function addQuick(delta: number) {
    const next = tenderedNum + delta;
    setTendered(String(Math.round(next * 100) / 100));
  }

  function setExact() {
    setTendered(String(Math.round(amountDue * 100) / 100));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && canConfirm) {
      e.preventDefault();
      onConfirm(tenderedNum);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('cashPad.title')}
      description={t('cashPad.description')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('cashPad.cancel')}
          </Button>
          <Button
            onClick={() => onConfirm(tenderedNum)}
            disabled={!canConfirm}
            loading={submitting}
            leftIcon={<CheckCircle2 className="w-4 h-4" />}
          >
            {t('cashPad.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Montant dû */}
        <div
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3"
          aria-label={t('cashPad.amountDue')}
        >
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t('cashPad.amountDue')}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Banknote className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            {formatCurrency(amountDue)}
          </div>
        </div>

        {/* Tendered */}
        <div>
          <label
            htmlFor="cashPad-tendered"
            className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
          >
            {t('cashPad.tenderedLabel')}
          </label>
          <input
            id="cashPad-tendered"
            ref={inputRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            className={inputClass}
            value={tendered}
            onChange={(e) => setTendered(e.target.value)}
            onKeyDown={handleKey}
            disabled={submitting}
            aria-describedby="cashPad-change"
            aria-invalid={insufficient}
          />
          {/* Raccourcis billets */}
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={t('cashPad.quickAmounts')}>
            <button
              type="button"
              onClick={setExact}
              className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              disabled={submitting}
            >
              {t('cashPad.exact')}
            </button>
            {quickAmounts.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => addQuick(amt)}
                className="text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                disabled={submitting}
              >
                +{formatCurrency(amt)}
              </button>
            ))}
          </div>
        </div>

        {/* Change */}
        <div
          id="cashPad-change"
          aria-live="polite"
          className={`rounded-lg border px-4 py-3 ${
            insufficient
              ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/20'
              : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
          }`}
        >
          <div className="text-xs uppercase tracking-wide text-slate-600 dark:text-slate-300 flex items-center gap-1">
            {insufficient ? (
              <>
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                {t('cashPad.insufficient')}
              </>
            ) : (
              <>
                <Calculator className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                {t('cashPad.change')}
              </>
            )}
          </div>
          <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50">
            {insufficient
              ? formatCurrency(amountDue - tenderedNum)
              : formatCurrency(change)}
          </div>
          {insufficient && (
            <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
              {t('cashPad.insufficientHint')}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
